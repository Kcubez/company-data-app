import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  isReportType,
  parseDemandMessageWithGemini,
  answerQuestionWithGemini,
  extractDataFromFile,
  isFileTooLarge,
  REPORT_TYPES,
  type ReportType,
  type ParsedDemandRecord,
} from "@/lib/demand-parser";
import { NextRequest, NextResponse } from "next/server";

function displayNameFromTelegramUser(from: { first_name?: string; last_name?: string }) {
  return [from.first_name, from.last_name].filter(Boolean).join(" ");
}

function normalizeCustomerName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

async function getActiveBotSettings() {
  return prisma.botSettings.findFirst({
    where: { isActive: true },
    select: {
      botToken: true,
      geminiApiKey: true,
      geminiModel: true,
    },
  });
}

async function sendTelegramMessage({
  botToken,
  chatId,
  text,
  replyMarkup,
}: {
  botToken: string | null | undefined;
  chatId: bigint | number;
  text: string;
  replyMarkup?: Record<string, unknown>;
}) {
  if (!botToken) return;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId.toString(),
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

async function answerCallbackQuery(botToken: string | null | undefined, callbackQueryId: string, text: string) {
  if (!botToken) return;
  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text }),
  }).catch((err) => console.error("Error answering callback:", err));
}

async function editTelegramMessage({
  botToken,
  chatId,
  messageId,
  text,
  replyMarkup,
}: {
  botToken: string | null | undefined;
  chatId: bigint | number;
  messageId: number;
  text: string;
  replyMarkup?: Record<string, unknown>;
}) {
  if (!botToken) return;
  await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId.toString(),
      message_id: messageId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  }).catch((err) => console.error("Error editing message:", err));
}

async function downloadTelegramFile(
  botToken: string,
  fileId: string,
): Promise<{ buffer: Buffer; filePath: string } | null> {
  try {
    const fileRes = await fetch(
      `https://api.telegram.org/bot${botToken}/getFile`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_id: fileId }),
      },
    );
    const fileData = await fileRes.json();
    if (!fileData.ok || !fileData.result?.file_path) return null;

    const downloadUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
    const downloadRes = await fetch(downloadUrl);
    if (!downloadRes.ok) return null;

    const arrayBuffer = await downloadRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filePath: fileData.result.file_path as string,
    };
  } catch (err) {
    console.error('Error downloading Telegram file:', err);
    return null;
  }
}

function getFileInfoFromMessage(message: Record<string, unknown>): {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
} | null {
  // Document (PDF, Excel, text, etc.)
  const doc = message.document as Record<string, unknown> | undefined;
  if (doc) {
    return {
      fileId: doc.file_id as string,
      fileName: (doc.file_name as string) || 'document',
      mimeType: (doc.mime_type as string) || 'application/octet-stream',
      fileSize: (doc.file_size as number) || 0,
    };
  }

  // Photo (array of sizes, pick largest)
  const photos = message.photo as Array<Record<string, unknown>> | undefined;
  if (photos && photos.length > 0) {
    const largest = photos[photos.length - 1];
    return {
      fileId: largest.file_id as string,
      fileName: 'photo.jpg',
      mimeType: 'image/jpeg',
      fileSize: (largest.file_size as number) || 0,
    };
  }

  // Audio
  const audio = message.audio as Record<string, unknown> | undefined;
  if (audio) {
    return {
      fileId: audio.file_id as string,
      fileName: (audio.file_name as string) || 'audio',
      mimeType: (audio.mime_type as string) || 'audio/mpeg',
      fileSize: (audio.file_size as number) || 0,
    };
  }

  // Voice
  const voice = message.voice as Record<string, unknown> | undefined;
  if (voice) {
    return {
      fileId: voice.file_id as string,
      fileName: 'voice.ogg',
      mimeType: (voice.mime_type as string) || 'audio/ogg',
      fileSize: (voice.file_size as number) || 0,
    };
  }

  // Video
  const video = message.video as Record<string, unknown> | undefined;
  if (video) {
    return {
      fileId: video.file_id as string,
      fileName: (video.file_name as string) || 'video.mp4',
      mimeType: (video.mime_type as string) || 'video/mp4',
      fileSize: (video.file_size as number) || 0,
    };
  }

  return null;
}

async function upsertSender(from: {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
}) {
  const displayName = displayNameFromTelegramUser(from);
  return prisma.telegramSender.upsert({
    where: { telegramUserId: BigInt(from.id) },
    create: {
      telegramUserId: BigInt(from.id),
      firstName: from.first_name || "Unknown",
      lastName: from.last_name || null,
      username: from.username || null,
      displayName: displayName || "Unknown",
      messageCount: 0,
      lastMessageAt: null,
    },
    update: {
      firstName: from.first_name || undefined,
      lastName: from.last_name || null,
      username: from.username || null,
      displayName: displayName || undefined,
    },
  });
}

const MAIN_MENU_BUTTONS = {
  inline_keyboard: [
    [{ text: "🤖 Q & A", callback_data: "mode:qa" }],
    [{ text: "📊 Reports", callback_data: "mode:reports" }],
  ],
};

const REPORT_TYPE_BUTTONS = {
  inline_keyboard: [
    [{ text: "📈 Business Report", callback_data: "report_type:business_report" }],
    [{ text: "🔮 Future Plan Report", callback_data: "report_type:future_plan" }],
    [{ text: "⬅️ Back", callback_data: "mode:back" }],
  ],
};

function getFormatPrompt(reportType: ReportType): string {
  if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
    return [
      "<b>📈 Business Report</b> ရွေးထားပါတယ်။",
      "",
      "ဒီ format နဲ့ပို့လို့ရပါတယ်:",
      "Total Sales: (ရောင်းရငွေ)",
      "Demand: (demand အရေအတွက်)",
      "Service: (နာမည်) - Amount: (ငွေ) - Qty: (အရေအတွက်)",
      "Appointments: (ချိန်းဆိုမှု အရေအတွက်)",
      "Project: (နာမည်) - Status: (on_track/delayed/completed)",
      "Marketing Budget: (ကုန်ကျစရိတ်)",
      "",
      "မှတ်ချက်: မလိုတာတွေ ချန်ထားလို့ရပါတယ်။",
    ].join("\n");
  }

  return [
    "<b>🔮 Future Plan Report</b> ရွေးထားပါတယ်။",
    "",
    "ဒီ format နဲ့ပို့လို့ရပါတယ်:",
    "Follow-up: (client နာမည်) - Reason: (ဘာကြောင့်)",
    "Focus Service: (service နာမည်) - Reason: (ဘာကြောင့်)",
    "Delayed Project: (project နာမည်) - Reason: (ဘာကြောင့်)",
    "Next Steps: (ဘာတွေဆက်လုပ်မလဲ)",
    "",
    "မှတ်ချက်: မလိုတာတွေ ချန်ထားလို့ရပါတယ်။",
  ].join("\n");
}

async function buildQAContext(): Promise<string> {
  const parts: string[] = [];

  // Recent business reports
  const bizReports = await prisma.demandRecord.findMany({
    where: { reportType: 'business_report' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { sender: true },
  });
  if (bizReports.length > 0) {
    parts.push('=== RECENT BUSINESS REPORTS ===');
    for (const r of bizReports) {
      const fields = [
        `Date: ${r.createdAt.toISOString().slice(0, 10)}`,
        `Reporter: ${r.sender.displayName}`,
        r.totalSales ? `Total Sales: ${r.totalSales}` : '',
        r.demand ? `Demand: ${r.demand}` : '',
        r.serviceName ? `Service: ${r.serviceName} (Amount: ${r.serviceAmount || '-'}, Qty: ${r.serviceQty || '-'})` : '',
        r.appointments ? `Appointments: ${r.appointments}` : '',
        r.projectName ? `Project: ${r.projectName} (Status: ${r.projectStatus || '-'})` : '',
        r.marketingBudget ? `Marketing Budget: ${r.marketingBudget}` : '',
        `Note: ${r.note}`,
      ].filter(Boolean).join(', ');
      parts.push(fields);
    }
  }

  // Recent future plans
  const futurePlans = await prisma.demandRecord.findMany({
    where: { reportType: 'future_plan' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { sender: true },
  });
  if (futurePlans.length > 0) {
    parts.push('\n=== RECENT FUTURE PLANS ===');
    for (const r of futurePlans) {
      const fields = [
        `Date: ${r.createdAt.toISOString().slice(0, 10)}`,
        `Reporter: ${r.sender.displayName}`,
        r.followUpClient ? `Follow-up Client: ${r.followUpClient} (${r.followUpReason || ''})` : '',
        r.focusService ? `Focus Service: ${r.focusService} (${r.focusReason || ''})` : '',
        r.delayedProject ? `Delayed Project: ${r.delayedProject} (${r.delayReason || ''})` : '',
        r.nextSteps ? `Next Steps: ${r.nextSteps}` : '',
        `Note: ${r.note}`,
      ].filter(Boolean).join(', ');
      parts.push(fields);
    }
  }

  // QA Documents
  const qaDocs = await prisma.qADocument.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  if (qaDocs.length > 0) {
    parts.push('\n=== REFERENCE DOCUMENTS ===');
    for (const doc of qaDocs) {
      parts.push(`[${doc.title}]: ${doc.content.slice(0, 500)}`);
    }
  }

  // Customers
  const customers = await prisma.customer.findMany({
    take: 20,
    orderBy: { updatedAt: 'desc' },
  });
  if (customers.length > 0) {
    parts.push('\n=== CUSTOMERS ===');
    parts.push(customers.map(c => `${c.name} (${c.status})`).join(', '));
  }

  return parts.join('\n') || 'No business data available yet.';
}

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get('x-telegram-bot-api-secret-token');
    const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (expectedSecret && secret !== expectedSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const settings = await getActiveBotSettings();
    const callbackQuery = body.callback_query;

    // ─── Handle Callback Queries (Button presses) ─────────────────────
    if (callbackQuery?.data && callbackQuery.from) {
      const sender = await upsertSender(callbackQuery.from);
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;
      const data = callbackQuery.data;

      if (data === 'mode:qa') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'qa' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Q & A mode selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              "🤖 <b>Q & A Mode</b>",
              "",
              "မေးချင်တာကို ရိုက်ပြီး မေးမြန်းနိုင်ပါတယ်။",
              "ရှိပြီးသား business data တွေအပေါ်မှာ AI က ဖြေပေးပါမယ်။",
              "",
              "Menu သို့ ပြန်သွားချင်ရင် /start နှိပ်ပါ။",
            ].join("\n"),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:reports') {
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Reports menu');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: "📊 <b>Reports</b>\n\nဘယ် report အမျိုးအစား ရွေးချင်ပါသလဲ။",
            replyMarkup: REPORT_TYPE_BUTTONS,
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:back') {
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Main menu');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: "👋 ဘာလုပ်ချင်ပါသလဲ။",
            replyMarkup: MAIN_MENU_BUTTONS,
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('report_type:')) {
        const selectedType = data.replace('report_type:', '');
        if (!isReportType(selectedType) || selectedType === 'qa') {
          return NextResponse.json({ ok: true });
        }

        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: selectedType },
        });

        await answerCallbackQuery(
          settings?.botToken,
          callbackQuery.id,
          `${selectedType === 'business_report' ? 'Business Report' : 'Future Plan'} selected`
        );

        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getFormatPrompt(selectedType),
          });
        }
        return NextResponse.json({ ok: true });
      }

      return NextResponse.json({ ok: true });
    }

    // ─── Handle Messages (text + files) ────────────────────────────────
    const message = body.message;
    if (!message) {
      return NextResponse.json({ ok: true });
    }

    const fileInfo = getFileInfoFromMessage(message);
    const hasText = !!message.text;
    const hasFile = !!fileInfo;

    // Ignore messages with neither text nor file
    if (!hasText && !hasFile) {
      return NextResponse.json({ ok: true });
    }

    const from = message.from;
    if (!from) return NextResponse.json({ ok: true });

    const sender = await upsertSender(from);
    const chatId = BigInt(message.chat.id);

    // /start command → Main Menu
    if (message.text === '/start' || message.text === '/menu') {
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: "👋 <b>မင်္ဂလာပါ!</b>\n\nဘာလုပ်ချင်ပါသလဲခင်‌ဗျာ။",
        replyMarkup: MAIN_MENU_BUTTONS,
      });
      return NextResponse.json({ ok: true });
    }

    // ─── Handle File Uploads ──────────────────────────────────────────
    if (hasFile && fileInfo) {
      const receivedAt = new Date(message.date * 1000);
      const updatedSender = await prisma.telegramSender.update({
        where: { id: sender.id },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
        },
      });

      const activeMode = updatedSender.activeReportType;

      // In Q&A mode, files are not accepted — tell user to switch to Reports
      if (activeMode === 'qa') {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: "⚠️ Q & A mode မှာ ဖိုင်လက်ခံလို့မရပါ။\n\nReport mode ကိုပြောင်းပြီး ဖိုင်ပို့ပေးပါ။\n/start နှိပ်ပြီး Reports ကိုရွေးပါ။",
        });
        return NextResponse.json({ ok: true });
      }

      // Check file size
      if (isFileTooLarge(fileInfo.fileSize)) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: "⚠️ ဖိုင်ဆိုဒ် ကြီးလွန်းပါသည်။ 10MB အောက် ဖိုင်ပို့ပေးပါ။",
        });
        return NextResponse.json({ ok: true });
      }

      // Check API key
      if (!settings?.geminiApiKey || !settings?.botToken) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: "⚠️ Gemini API key သို့မဟုတ် Bot Token မရှိသေးပါ။ Settings မှာ ထည့်ပါ။",
        });
        return NextResponse.json({ ok: true });
      }

      // Send processing indicator
      await sendTelegramMessage({
        botToken: settings.botToken,
        chatId,
        text: `⏳ <b>${fileInfo.fileName}</b> ဖိုင်ကို ဖတ်နေပါသည်...`,
      });

      // Download the file
      const downloaded = await downloadTelegramFile(settings.botToken, fileInfo.fileId);
      if (!downloaded) {
        await sendTelegramMessage({
          botToken: settings.botToken,
          chatId,
          text: "❌ ဖိုင်ဒေါင်းလုဒ် မအောင်မြင်ပါ။ ပြန်လည်ပို့ပေးပါ။",
        });
        return NextResponse.json({ ok: true });
      }

      const reportType: ReportType = isReportType(activeMode) && activeMode !== 'qa'
        ? activeMode
        : REPORT_TYPES.BUSINESS_REPORT;

      try {
        const caption = (message.caption as string) || undefined;
        const { extractedText, parsed: parsedDemands } = await extractDataFromFile({
          fileBuffer: downloaded.buffer,
          mimeType: fileInfo.mimeType,
          fileName: fileInfo.fileName,
          reportType,
          caption,
          apiKey: settings.geminiApiKey,
          model: settings.geminiModel,
        });

        // Store extracted content as QADocument (for Q&A context)
        await prisma.qADocument.create({
          data: {
            title: `📎 ${fileInfo.fileName}`,
            content: extractedText.slice(0, 10000), // limit content size
            source: 'telegram_file',
            fileType: fileInfo.mimeType,
            fileName: fileInfo.fileName,
            senderId: sender.id,
          },
        });

        // For each extracted demand record, resolve / create the customer
        // and build the nested create input.
        const demandRecordCreates: Prisma.DemandRecordUncheckedCreateWithoutMessageInput[] = [];
        for (const parsedDemand of parsedDemands) {
          let customerId: string | null = null;
          if (parsedDemand.customerName) {
            const normalizedName = normalizeCustomerName(parsedDemand.customerName);
            let customer = await prisma.customer.findFirst({
              where: { nameNormalized: normalizedName },
            });
            if (!customer) {
              customer = await prisma.customer.findUnique({
                where: { name: parsedDemand.customerName },
              });
            }
            if (customer) {
              await prisma.customer.update({
                where: { id: customer.id },
                data: {
                  updatedAt: new Date(),
                  nameNormalized: customer.nameNormalized || normalizedName,
                },
              });
            } else {
              customer = await prisma.customer.create({
                data: {
                  name: parsedDemand.customerName,
                  nameNormalized: normalizedName,
                },
              });
            }
            customerId = customer.id;

            await prisma.customerActivity.create({
              data: {
                customerId: customer.id,
                senderId: sender.id,
                action: reportType,
                description: `File: ${fileInfo.fileName} - ${parsedDemand.note}`,
              },
            });
          }

          demandRecordCreates.push({
            senderId: sender.id,
            customerId,
            reportType: parsedDemand.reportType,
            customerName: parsedDemand.customerName,
            category: parsedDemand.category,
            status: parsedDemand.status,
            note: parsedDemand.note,
            totalSales: parsedDemand.totalSales,
            demand: parsedDemand.demand,
            serviceName: parsedDemand.serviceName,
            serviceAmount: parsedDemand.serviceAmount,
            serviceQty: parsedDemand.serviceQty,
            appointments: parsedDemand.appointments,
            projectName: parsedDemand.projectName,
            projectStatus: parsedDemand.projectStatus,
            marketingBudget: parsedDemand.marketingBudget,
            followUpClient: parsedDemand.followUpClient,
            followUpReason: parsedDemand.followUpReason,
            focusService: parsedDemand.focusService,
            focusReason: parsedDemand.focusReason,
            delayedProject: parsedDemand.delayedProject,
            delayReason: parsedDemand.delayReason,
            nextSteps: parsedDemand.nextSteps,
            quantity: parsedDemand.quantity,
            product: parsedDemand.product,
            amount: parsedDemand.amount,
            unit: parsedDemand.unit,
            followUpDate: parsedDemand.followUpDate,
            confidence: parsedDemand.confidence,
            aiProvider: parsedDemand.aiProvider,
            aiModel: parsedDemand.aiModel,
          });
        }

        // Create the parent message + all its demand records in one go.
        await prisma.telegramMessage.create({
          data: {
            telegramMsgId: message.message_id,
            text: `[File: ${fileInfo.fileName}] ${caption || ''}`.trim(),
            senderId: sender.id,
            chatId,
            chatTitle: message.chat.title || null,
            receivedAt,
            demandRecords: {
              create: demandRecordCreates,
            },
          },
        });

        // Confirmation message — summarize every extracted record.
        const confirmParts = [
          `✅ <b>ဖိုင်မှတ်ပြီးပါပြီ!</b> (${parsedDemands.length} record${parsedDemands.length === 1 ? '' : 's'})`,
          `📎 ${fileInfo.fileName}`,
        ];

        parsedDemands.forEach((parsedDemand, idx) => {
          const header = `\n<b>#${idx + 1}</b>`;
          const lines: string[] = [header];
          if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
            if (parsedDemand.customerName) lines.push(`👤 Customer: ${parsedDemand.customerName}`);
            if (parsedDemand.totalSales) lines.push(`💰 Total Sales: ${parsedDemand.totalSales.toLocaleString()}`);
            if (parsedDemand.demand) lines.push(`📈 Demand: ${parsedDemand.demand}`);
            if (parsedDemand.serviceName) lines.push(`🛠️ Service: ${parsedDemand.serviceName}`);
            if (parsedDemand.appointments) lines.push(`📅 Appointments: ${parsedDemand.appointments}`);
            if (parsedDemand.projectName) lines.push(`📁 Project: ${parsedDemand.projectName} (${parsedDemand.projectStatus || 'new'})`);
            if (parsedDemand.marketingBudget) lines.push(`💸 Marketing: ${parsedDemand.marketingBudget.toLocaleString()}`);
          } else {
            if (parsedDemand.followUpClient) lines.push(`👤 Follow-up: ${parsedDemand.followUpClient}`);
            if (parsedDemand.focusService) lines.push(`🎯 Focus: ${parsedDemand.focusService}`);
            if (parsedDemand.delayedProject) lines.push(`⚠️ Delayed: ${parsedDemand.delayedProject}`);
            if (parsedDemand.nextSteps) lines.push(`➡️ Next: ${parsedDemand.nextSteps}`);
          }
          if (parsedDemand.note) lines.push(`📋 ${parsedDemand.note}`);
          confirmParts.push(lines.join('\n'));
        });

        await sendTelegramMessage({
          botToken: settings.botToken,
          chatId,
          text: confirmParts.join('\n'),
        });

        return NextResponse.json({ ok: true });
      } catch (err) {
        console.error('File processing error:', err);
        await sendTelegramMessage({
          botToken: settings.botToken,
          chatId,
          text: "❌ ဖိုင်ဖတ်ရာတွင် အမှားရှိပါသည်။ ပြန်လည်ကြိုးစားပါ။",
        });
        return NextResponse.json({ ok: true });
      }
    }

    // ─── Text-only messages below ─────────────────────────────────────
    if (!hasText) {
      return NextResponse.json({ ok: true });
    }



    // Update sender stats
    const receivedAt = new Date(message.date * 1000);
    const updatedSender = await prisma.telegramSender.update({
      where: { id: sender.id },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });

    const activeMode = updatedSender.activeReportType;

    // ─── Q & A Mode ───────────────────────────────────────────────────
    if (activeMode === 'qa') {
      if (!settings?.geminiApiKey) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: "⚠️ Gemini API key မရှိသေးပါ။ Settings မှာ ထည့်ပါ။",
        });
        return NextResponse.json({ ok: true });
      }

      // Store the message
      await prisma.telegramMessage.create({
        data: {
          telegramMsgId: message.message_id,
          text: message.text,
          senderId: sender.id,
          chatId,
          chatTitle: message.chat.title || null,
          receivedAt,
        },
      });

      // Build context and answer
      const context = await buildQAContext();
      const answer = await answerQuestionWithGemini({
        question: message.text,
        context,
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
      });

      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: `🤖 ${answer}`,
      });

      return NextResponse.json({ ok: true });
    }

    // ─── Report Mode (Business or Future Plan) ───────────────────────
    const reportType: ReportType = isReportType(activeMode) && activeMode !== 'qa'
      ? activeMode
      : REPORT_TYPES.BUSINESS_REPORT;

    const parsedDemand = await parseDemandMessageWithGemini({
      text: message.text,
      receivedAt,
      reportType,
      apiKey: settings?.geminiApiKey,
      model: settings?.geminiModel,
    });

    // Customer matching
    let customerId: string | null = null;
    if (parsedDemand.customerName) {
      const normalizedName = normalizeCustomerName(parsedDemand.customerName);
      let customer = await prisma.customer.findFirst({
        where: { nameNormalized: normalizedName },
      });
      if (!customer) {
        customer = await prisma.customer.findUnique({
          where: { name: parsedDemand.customerName },
        });
      }
      if (customer) {
        await prisma.customer.update({
          where: { id: customer.id },
          data: {
            updatedAt: new Date(),
            nameNormalized: customer.nameNormalized || normalizedName,
          },
        });
      } else {
        customer = await prisma.customer.create({
          data: {
            name: parsedDemand.customerName,
            nameNormalized: normalizedName,
          },
        });
      }
      customerId = customer.id;

      await prisma.customerActivity.create({
        data: {
          customerId: customer.id,
          senderId: sender.id,
          action: reportType,
          description: parsedDemand.note,
        },
      });
    }

    // Create message + demand record
    await prisma.telegramMessage.create({
      data: {
        telegramMsgId: message.message_id,
        text: message.text,
        senderId: sender.id,
        chatId,
        chatTitle: message.chat.title || null,
        receivedAt,
        demandRecords: {
          create: [
            {
              senderId: sender.id,
              customerId,
              reportType: parsedDemand.reportType,
              customerName: parsedDemand.customerName,
              category: parsedDemand.category,
              status: parsedDemand.status,
              note: parsedDemand.note,
              totalSales: parsedDemand.totalSales,
              demand: parsedDemand.demand,
              serviceName: parsedDemand.serviceName,
              serviceAmount: parsedDemand.serviceAmount,
              serviceQty: parsedDemand.serviceQty,
              appointments: parsedDemand.appointments,
              projectName: parsedDemand.projectName,
              projectStatus: parsedDemand.projectStatus,
              marketingBudget: parsedDemand.marketingBudget,
              followUpClient: parsedDemand.followUpClient,
              followUpReason: parsedDemand.followUpReason,
              focusService: parsedDemand.focusService,
              focusReason: parsedDemand.focusReason,
              delayedProject: parsedDemand.delayedProject,
              delayReason: parsedDemand.delayReason,
              nextSteps: parsedDemand.nextSteps,
              quantity: parsedDemand.quantity,
              product: parsedDemand.product,
              amount: parsedDemand.amount,
              unit: parsedDemand.unit,
              followUpDate: parsedDemand.followUpDate,
              confidence: parsedDemand.confidence,
              aiProvider: parsedDemand.aiProvider,
              aiModel: parsedDemand.aiModel,
            },
          ],
        },
      },
    });

    // Confirmation message
    const confirmParts = ['✅ <b>မှတ်ပြီးပါပြီ!</b>'];
    if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
      confirmParts.push(`📊 Report Type: Business Report`);
      if (parsedDemand.totalSales) confirmParts.push(`💰 Total Sales: ${parsedDemand.totalSales.toLocaleString()}`);
      if (parsedDemand.demand) confirmParts.push(`📈 Demand: ${parsedDemand.demand}`);
      if (parsedDemand.serviceName) confirmParts.push(`🛠️ Service: ${parsedDemand.serviceName}`);
      if (parsedDemand.appointments) confirmParts.push(`📅 Appointments: ${parsedDemand.appointments}`);
      if (parsedDemand.projectName) confirmParts.push(`📁 Project: ${parsedDemand.projectName} (${parsedDemand.projectStatus || 'new'})`);
      if (parsedDemand.marketingBudget) confirmParts.push(`💸 Marketing: ${parsedDemand.marketingBudget.toLocaleString()}`);
    } else {
      confirmParts.push(`🔮 Report Type: Future Plan`);
      if (parsedDemand.followUpClient) confirmParts.push(`👤 Follow-up: ${parsedDemand.followUpClient}`);
      if (parsedDemand.focusService) confirmParts.push(`🎯 Focus: ${parsedDemand.focusService}`);
      if (parsedDemand.delayedProject) confirmParts.push(`⚠️ Delayed: ${parsedDemand.delayedProject}`);
      if (parsedDemand.nextSteps) confirmParts.push(`➡️ Next: ${parsedDemand.nextSteps}`);
    }
    confirmParts.push(`\n📋 ${parsedDemand.note}`);

    await sendTelegramMessage({
      botToken: settings?.botToken,
      chatId,
      text: confirmParts.join('\n'),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
