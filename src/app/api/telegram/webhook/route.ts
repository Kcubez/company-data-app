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
import { NextRequest, NextResponse, after } from "next/server";

function displayNameFromTelegramUser(from: { first_name?: string; last_name?: string }) {
  return [from.first_name, from.last_name].filter(Boolean).join(" ");
}

function normalizeCustomerName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

function isPrismaUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function createTelegramMessageIfNew({
  telegramMsgId,
  text,
  senderId,
  chatId,
  chatTitle,
  receivedAt,
}: {
  telegramMsgId: number;
  text: string;
  senderId: string;
  chatId: bigint;
  chatTitle: string | null;
  receivedAt: Date;
}) {
  try {
    return await prisma.telegramMessage.create({
      data: {
        telegramMsgId,
        text,
        senderId,
        chatId,
        chatTitle,
        receivedAt,
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraintError(error)) {
      console.info(`Duplicate Telegram message ignored: ${telegramMsgId}`);
      return null;
    }

    throw error;
  }
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
}): Promise<any> {
  if (!botToken) return null;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        text,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ok ? data.result : null;
  } catch (err) {
    console.error("Error sending Telegram message:", err);
    return null;
  }
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
      "📈 <b>လုပ်ငန်းအစီရင်ခံစာ (Business Report) Mode</b>",
      "",
      "ဤကဏ္ဍတွင် အစီရင်ခံစာ စာသား သို့မဟုတ် သက်ဆိုင်ရာ Excel / CSV ဖိုင်များကို တိုက်ရိုက် ပေးပို့နိုင်ပါသည်။",
      "",
      "📝 <b>စာသားဖြင့် ပေးပို့လိုပါက အောက်ပါပုံစံအတိုင်း ရေးသားပေးပို့နိုင်ပါသည် -</b>",
      "<pre>",
      "• Total Sales: [ရောင်းရငွေပမာဏ]",
      "• Demand: [ဝယ်လိုအား အသေးစိတ်]",
      "• Service: [ဝန်ဆောင်မှုအမည်] - Amount: [ဝင်ငွေ] - Qty: [အရေအတွက်]",
      "• Appointments: [ချိန်းဆိုမှု အရေအတွက်]",
      "• Project: [စီမံကိန်းအမည်] - Status: [on_track / delayed / completed / at_risk]",
      "• Marketing Budget: [စျေးကွက်မြှင့်တင်ရေး အသုံးစရိတ်]",
      "• Note: [အခြားမှတ်ချက်]",
      "</pre>",
      "💡 <i>အကြံပြုချက်: မလိုအပ်သော စာကြောင်းများကို ချန်လှပ်ထားနိုင်ပါသည်။ Excel/CSV ဖိုင် တင်သွင်းပါကလည်း AI မှ အလိုအလျောက် ဆန်းစစ်ပေးမည် ဖြစ်ပါသည်။</i>",
    ].join("\n");
  }

  return [
    "🔮 <b>ရှေ့လုပ်ငန်းစဉ်အစီအမံ (Future Plan) Mode</b>",
    "",
    "ဤကဏ္ဍတွင် အစီအမံ စာသား သို့မဟုတ် သက်ဆိုင်ရာ Excel / CSV ဖိုင်များကို တိုက်ရိုက် ပေးပို့နိုင်ပါသည်။",
    "",
    "📝 <b>စာသားဖြင့် ပေးပို့လိုပါက အောက်ပါပုံစံအတိုင်း ရေးသားပေးပို့နိုင်ပါသည် -</b>",
    "<pre>",
    "• Follow-up: [Client နာမည်] - Reason: [ဆက်သွယ်ရမည့် အကြောင်းရင်း]",
    "• Focus Service: [ဝန်ဆောင်မှုအမည်] - Reason: [အကြောင်းရင်း]",
    "• Delayed Project: [စီမံကိန်းအမည်] - Reason: [အကြောင်းရင်း]",
    "• Next Steps: [ရှေ့ဆက်လုပ်ဆောင်မည့် အဆင့်များ]",
    "• Note: [အခြားမှတ်ချက်]",
    "</pre>",
    "💡 <i>အကြံပြုချက်: မလိုအပ်သော စာကြောင်းများကို ချန်လှပ်ထားနိုင်ပါသည်။ Excel/CSV ဖိုင် တင်သွင်းပါကလည်း AI မှ အလိုအလျောက် ဆန်းစစ်ပေးမည် ဖြစ်ပါသည်။</i>",
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

async function processFileInBackground({
  downloadedBuffer,
  fileInfo,
  reportType,
  caption,
  settings,
  chatId,
  senderId,
  telegramMessageId,
  progressMsgId,
}: {
  downloadedBuffer: Buffer;
  fileInfo: { fileName: string; mimeType: string; fileSize: number };
  reportType: ReportType;
  caption?: string;
  settings: { botToken: string | null; geminiApiKey: string | null; geminiModel: string | null };
  chatId: bigint;
  senderId: string;
  telegramMessageId: string;
  progressMsgId: number | null;
}) {
  const errors: string[] = [];
  try {
    const { extractedText, parsed: parsedDemands } = await extractDataFromFile({
      fileBuffer: downloadedBuffer,
      mimeType: fileInfo.mimeType,
      fileName: fileInfo.fileName,
      reportType,
      caption,
      apiKey: settings.geminiApiKey!,
      model: settings.geminiModel,
      onProgress: async (current, total, errorMsg) => {
        if (errorMsg) {
          errors.push(errorMsg);
        }
        if (progressMsgId) {
          const statusText = errorMsg
            ? [
                "⚠️ <b>ဖိုင်ဆန်းစစ်မှု သတိပေးချက်</b>",
                "━━━━━━━━━━━━━━━━━━━━",
                `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
                `⚙️ <b>အခြေအနေ:</b> အပိုင်း (<code>${current}/${total}</code>) chunks ဖတ်ယူရာတွင် ချို့ယွင်းချက် ရှိခဲ့ပါသည်။`,
                `❌ <b>အသေးစိတ်:</b> <code>${errorMsg}</code>`,
              ].join("\n")
            : [
                "⏳ <b>ဖိုင်ကို အသေးစိတ် ဆန်းစစ်နေပါသည်</b>",
                "━━━━━━━━━━━━━━━━━━━━",
                `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
                `📊 <b>တိုးတက်မှု အခြေအနေ:</b> အပိုင်း (<code>${current}/${total}</code>) chunks ကို ဆန်းစစ်နေပါသည်...`,
              ].join("\n");

          await editTelegramMessage({
            botToken: settings.botToken,
            chatId,
            messageId: progressMsgId,
            text: statusText,
          });
        }
      }
    });

    // Store extracted content as QADocument (for Q&A context)
    await prisma.qADocument.create({
      data: {
        title: `📎 ${fileInfo.fileName}`,
        content: extractedText.slice(0, 10000), // limit content size
        source: 'telegram_file',
        fileType: fileInfo.mimeType,
        fileName: fileInfo.fileName,
        senderId: senderId,
      },
    });

    // For each extracted demand record, resolve / create the customer
    // and build the nested create input.
    const demandRecordCreates: Prisma.DemandRecordUncheckedCreateInput[] = [];
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
            senderId: senderId,
            action: reportType,
            description: `File: ${fileInfo.fileName} - ${parsedDemand.note}`,
          },
        });
      }

      demandRecordCreates.push({
        messageId: telegramMessageId,
        senderId: senderId,
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

    if (demandRecordCreates.length > 0) {
      await prisma.demandRecord.createMany({
        data: demandRecordCreates,
      });
    }

    // Confirmation message — summarize every extracted record.
    const confirmParts = [];
    if (errors.length > 0) {
      confirmParts.push([
        "⚠️ <b>ဖိုင်အချက်အလက် တင်သွင်းမှု သတိပေးချက်</b>",
        "━━━━━━━━━━━━━━━━━━━━",
        `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
        `⚠️ <b>အခြေအနေ:</b> အချက်အလက်များအား အပြည့်အစုံ ဖတ်ယူနိုင်ခြင်း မရှိပါ။ (မှတ်တမ်း <b>${parsedDemands.length}</b> ခုအား သွင်းယူပြီး)`,
        "",
        "❌ <b>ချို့ယွင်းချက်ရှိခဲ့သော အပိုင်းများ (Chunks):</b>",
      ].join("\n"));
      errors.forEach((errLine) => {
        confirmParts.push(`• <code>${errLine}</code>`);
      });
      confirmParts.push(""); // empty line
    } else {
      confirmParts.push([
        "✅ <b>ဖိုင်အချက်အလက် တင်သွင်းမှု အောင်မြင်ပါသည်</b>",
        "━━━━━━━━━━━━━━━━━━━━",
        `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
        `📊 <b>စုစုပေါင်း မှတ်တမ်း:</b> <b>${parsedDemands.length}</b> records`,
        "",
      ].join("\n"));
    }

    if (parsedDemands.length > 0) {
      confirmParts.push([
        "📋 <b>နမူနာ တင်သွင်းခဲ့သည့် အချက်အလက်များ (ပထမဆုံး ၁၀ ခု)</b>",
        "━━━━━━━━━━━━━━━━━━━━",
      ].join("\n"));
    }

    parsedDemands.slice(0, 10).forEach((parsedDemand, idx) => {
      const recordHeader = `<b>#${idx + 1} 👤 ${parsedDemand.customerName || parsedDemand.followUpClient || 'အမည်မဖော်ပြထားသူ'}</b>`;
      const lines: string[] = [recordHeader];
      if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
        if (parsedDemand.totalSales) lines.push(`  ▫️ <b>Total Sales:</b> 💰 ${parsedDemand.totalSales.toLocaleString()} Ks`);
        if (parsedDemand.demand) lines.push(`  ▫️ <b>Demand:</b> 📈 ${parsedDemand.demand}`);
        if (parsedDemand.serviceName) lines.push(`  ▫️ <b>Service:</b> 🛠️ ${parsedDemand.serviceName}`);
        if (parsedDemand.appointments) lines.push(`  ▫️ <b>Appointments:</b> 📅 ${parsedDemand.appointments}`);
        if (parsedDemand.projectName) lines.push(`  ▫️ <b>Project:</b> 📁 ${parsedDemand.projectName} (${parsedDemand.projectStatus || 'new'})`);
        if (parsedDemand.marketingBudget) lines.push(`  ▫️ <b>Marketing:</b> 💸 ${parsedDemand.marketingBudget.toLocaleString()} Ks`);
      } else {
        if (parsedDemand.focusService) lines.push(`  ▫️ <b>Focus:</b> 🎯 ${parsedDemand.focusService}`);
        if (parsedDemand.delayedProject) lines.push(`  ▫️ <b>Delayed:</b> ⚠️ ${parsedDemand.delayedProject}`);
        if (parsedDemand.nextSteps) lines.push(`  ▫️ <b>Next:</b> ➡️ ${parsedDemand.nextSteps}`);
      }
      if (parsedDemand.note) lines.push(`  ▫️ <b>Note:</b> 📋 <i>${parsedDemand.note}</i>`);
      confirmParts.push(lines.join('\n'));
    });

    if (parsedDemands.length > 10) {
      confirmParts.push(`\n... <i>နှင့် ကျန်ရှိသော ${parsedDemands.length - 10} records ကိုလည်း အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။</i>`);
    }

    if (progressMsgId) {
      await editTelegramMessage({
        botToken: settings.botToken,
        chatId,
        messageId: progressMsgId,
        text: confirmParts.join('\n'),
      });
    } else {
      await sendTelegramMessage({
        botToken: settings.botToken,
        chatId,
        text: confirmParts.join('\n'),
      });
    }
  } catch (err: any) {
    console.error('Background file processing error:', err);
    const errorText = [
      "❌ <b>ဖိုင်ဆန်းစစ်ရာတွင် ချို့ယွင်းချက် ဖြစ်ပေါ်ခဲ့ပါသည်</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
      "⚠️ <b>အခြေအနေ:</b> နည်းပညာဆိုင်ရာ ချို့ယွင်းချက် ဖြစ်ပေါ်ခဲ့ပါသည်။ ကျေးဇူးပြု၍ ပြန်လည်ကြိုးစားပေးပါရန်။",
      "",
      "🔍 <b>အသေးစိတ် ချို့ယွင်းချက်:</b>",
      `<code>${err.message || err}</code>`,
    ].join("\n");
    if (progressMsgId) {
      await editTelegramMessage({
        botToken: settings.botToken,
        chatId,
        messageId: progressMsgId,
        text: errorText,
      });
    } else {
      await sendTelegramMessage({
        botToken: settings.botToken,
        chatId,
        text: errorText,
      });
    }
  }
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
              "🤖 <b>Q&A (အမေး/အဖြေ) ကဏ္ဍ</b>",
              "",
              "စနစ်အတွင်းရှိ လုပ်ငန်းဆိုင်ရာ အချက်အလက်များ (Business Data) ကို အခြေခံ၍ <b>Gemini AI</b> မှ ဆန်းစစ်ဖြေကြားပေးမည် ဖြစ်ပါသည်။ သိရှိလိုသည်များကို မေးမြန်းနိုင်ပါသည်။",
              "",
              "💡 <i>ဥပမာမေးခွန်းများ -</i>",
              "• <code>ယနေ့ အရောင်းရဆုံး ဝန်ဆောင်မှုက ဘာလဲ?</code>",
              "• <code>ပြီးခဲ့တဲ့အပတ်က ဘယ်စီမံကိန်းတွေ ကြန့်ကြာနေသလဲ?</code>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "↩️ <b>အဓိက Menu သို့ ပြန်သွားရန်:</b> /start သို့မဟုတ် /menu ဟု ပေးပို့နိုင်ပါသည်။",
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
            text: [
              "📊 <b>အစီရင်ခံစာ တင်သွင်းခြင်း (Reports Intake)</b>",
              "",
              "တင်သွင်းလိုသည့် အစီရင်ခံစာ အမျိုးအစားကို ရွေးချယ်ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "📈 <b>Business Report:</b> နေ့စဉ် အရောင်း၊ ဝယ်လိုအား၊ လုပ်ငန်းနှင့် စီမံကိန်း အခြေအနေများ။",
              "🔮 <b>Future Plan:</b> ရှေ့ဆက်လုပ်ဆောင်မည့် အစီအစဉ်များနှင့် Follow-up Client များ။",
              "━━━━━━━━━━━━━━━━━━━━",
            ].join("\n"),
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
            text: [
              "👋 <b>မင်္ဂလာပါ ခင်ဗျာ/ရှင်။</b>",
              "",
              "<b>Company Data System</b> မှ လှိုက်လှဲစွာ ကြိုဆိုပါသည်။",
              "လုပ်ဆောင်လိုသည့် လုပ်ငန်းစဉ်အမျိုးအစားကို အောက်ပါ Menu မှ ရွေးချယ်ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "🤖 <b>Q&A မေးမြန်းရန်:</b> လုပ်ငန်းဆိုင်ရာ အချက်အလက်များကို AI ဖြင့် မေးမြန်းဆန်းစစ်ရန်။",
              "📊 <b>အစီရင်ခံစာများ တင်သွင်းရန်:</b> Daily Reports နှင့် Future Plans များ တင်သွင်းရန်။",
              "━━━━━━━━━━━━━━━━━━━━",
            ].join("\n"),
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
        text: [
          "👋 <b>မင်္ဂလာပါ ခင်ဗျာ/ရှင်။</b>",
          "",
          "<b>Company Data System</b> မှ လှိုက်လှဲစွာ ကြိုဆိုပါသည်။",
          "လုပ်ဆောင်လိုသည့် လုပ်ငန်းစဉ်အမျိုးအစားကို အောက်ပါ Menu မှ ရွေးချယ်ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "🤖 <b>Q&A မေးမြန်းရန်:</b> လုပ်ငန်းဆိုင်ရာ အချက်အလက်များကို AI ဖြင့် မေးမြန်းဆန်းစစ်ရန်။",
          "📊 <b>အစီရင်ခံစာများ တင်သွင်းရန်:</b> Daily Reports နှင့် Future Plans များ တင်သွင်းရန်။",
          "━━━━━━━━━━━━━━━━━━━━",
        ].join("\n"),
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
          text: [
            "⚠️ <b>Q&A မေးမြန်းခြင်း ကဏ္ဍတွင် ဖိုင်များ ပေးပို့၍ မရနိုင်ပါ။</b>",
            "",
            "အစီရင်ခံစာ (Report) တင်သွင်းရန်အတွက် Report Mode သို့ ပြောင်းလဲပေးပို့ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
            "/start သို့မဟုတ် /menu ကိုနှိပ်၍ 'Reports' ကို ရွေးချယ်နိုင်ပါသည်။",
          ].join("\n"),
        });
        return NextResponse.json({ ok: true });
      }

      // Check file size
      if (isFileTooLarge(fileInfo.fileSize)) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: [
            "⚠️ <b>ပေးပို့သော ဖိုင်အရွယ်အစားမှာ သတ်မှတ်ချက်ထက် ကျော်လွန်နေပါသည်။</b>",
            "",
            "ကျေးဇူးပြု၍ ဖိုင်အရွယ်အစား 10MB အောက်သာ ရှိသော ဖိုင်များကို ပေးပို့ပေးပါရန်။",
          ].join("\n"),
        });
        return NextResponse.json({ ok: true });
      }

      // Check API key
      if (!settings?.geminiApiKey || !settings?.botToken) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: [
            "⚠️ <b>စနစ်ပြင်ဆင်မှု လိုအပ်ချက်ရှိနေပါသည်။</b>",
            "",
            "Gemini API key သို့မဟုတ် Bot Token ထည့်သွင်းထားခြင်း မရှိသေးပါ။ ကျေးဇူးပြု၍ settings စာမျက်နှာတွင် သွားရောက်ထည့်သွင်းပေးပါရန်။",
          ].join("\n"),
        });
        return NextResponse.json({ ok: true });
      }

      const caption = (message.caption as string) || undefined;
      const telegramMessage = await createTelegramMessageIfNew({
        telegramMsgId: message.message_id,
        text: `[File: ${fileInfo.fileName}] ${caption || ''}`.trim(),
        senderId: sender.id,
        chatId,
        chatTitle: message.chat.title || null,
        receivedAt,
      });
      if (!telegramMessage) {
        return NextResponse.json({ ok: true });
      }

      // Send processing indicator
      const progressMsg = await sendTelegramMessage({
        botToken: settings.botToken,
        chatId,
        text: [
          "⏳ <b>ဖိုင်တင်သွင်းမှုကို စတင်လုပ်ဆောင်နေပါသည်</b>",
          "━━━━━━━━━━━━━━━━━━━━",
          `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
          "⚙️ <b>အခြေအနေ:</b> အချက်အလက်များအား ဖတ်ယူရန် ပြင်ဆင်နေပါသည်...",
        ].join("\n"),
      });
      const progressMsgId = progressMsg?.message_id || null;

      // Download the file
      const downloaded = await downloadTelegramFile(settings.botToken, fileInfo.fileId);
      if (!downloaded) {
        const errorText = [
          "❌ <b>ဖိုင်ဒေါင်းလုဒ် ရယူခြင်း မအောင်မြင်ပါ</b>",
          "━━━━━━━━━━━━━━━━━━━━",
          `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
          "⚠️ <b>အကြံပြုချက်:</b> ဖိုင်အား ပြန်လည်ပေးပို့ပေးပါရန် သို့မဟုတ် ဖိုင်ပုံစံ မှန်ကန်မှု ရှိမရှိ စစ်ဆေးပေးပါရန်။",
        ].join("\n");
        if (progressMsgId) {
          await editTelegramMessage({
            botToken: settings.botToken,
            chatId,
            messageId: progressMsgId,
            text: errorText,
          });
        } else {
          await sendTelegramMessage({
            botToken: settings.botToken,
            chatId,
            text: errorText,
          });
        }
        return NextResponse.json({ ok: true });
      }

      const reportType: ReportType = isReportType(activeMode) && activeMode !== 'qa'
        ? activeMode
        : REPORT_TYPES.BUSINESS_REPORT;

      // Start processing in background using after to keep Vercel execution active
      after(async () => {
        try {
          await processFileInBackground({
            downloadedBuffer: downloaded.buffer,
            fileInfo,
            reportType,
            caption,
            settings,
            chatId,
            senderId: sender.id,
            telegramMessageId: telegramMessage.id,
            progressMsgId,
          });
        } catch (err) {
          console.error("Unhandled error in processFileInBackground:", err);
        }
      });

      return NextResponse.json({ ok: true });
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
      const telegramMessage = await createTelegramMessageIfNew({
        telegramMsgId: message.message_id,
        text: message.text,
        senderId: sender.id,
        chatId,
        chatTitle: message.chat.title || null,
        receivedAt,
      });
      if (!telegramMessage) {
        return NextResponse.json({ ok: true });
      }

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

    const telegramMessage = await createTelegramMessageIfNew({
      telegramMsgId: message.message_id,
      text: message.text,
      senderId: sender.id,
      chatId,
      chatTitle: message.chat.title || null,
      receivedAt,
    });
    if (!telegramMessage) {
      return NextResponse.json({ ok: true });
    }

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
    await prisma.demandRecord.create({
      data: {
        messageId: telegramMessage.id,
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
    });

    // Confirmation message
    const confirmParts = [
      "✅ <b>အစီရင်ခံစာ မှတ်တမ်းတင်ခြင်း အောင်မြင်ပါသည်</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      ""
    ];
    if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
      confirmParts.push("📊 <b>အမျိုးအစား:</b> 📈 လုပ်ငန်းအစီရင်ခံစာ (Business Report)");
      if (parsedDemand.customerName) confirmParts.push(`👤 <b>Customer:</b> ${parsedDemand.customerName}`);
      if (parsedDemand.totalSales) confirmParts.push(`💰 <b>Total Sales:</b> ${parsedDemand.totalSales.toLocaleString()} Ks`);
      if (parsedDemand.demand) confirmParts.push(`📈 <b>Demand:</b> ${parsedDemand.demand}`);
      if (parsedDemand.serviceName) confirmParts.push(`🛠️ <b>Service:</b> ${parsedDemand.serviceName}`);
      if (parsedDemand.appointments) confirmParts.push(`📅 <b>Appointments:</b> ${parsedDemand.appointments}`);
      if (parsedDemand.projectName) confirmParts.push(`📁 <b>Project:</b> ${parsedDemand.projectName} (${parsedDemand.projectStatus || 'new'})`);
      if (parsedDemand.marketingBudget) confirmParts.push(`💸 <b>Marketing:</b> ${parsedDemand.marketingBudget.toLocaleString()} Ks`);
    } else {
      confirmParts.push("📊 <b>အမျိုးအစား:</b> 🔮 ရှေ့လုပ်ငန်းစဉ်အစီအမံ (Future Plan)");
      if (parsedDemand.followUpClient) confirmParts.push(`👤 <b>Follow-up Client:</b> ${parsedDemand.followUpClient}`);
      if (parsedDemand.focusService) confirmParts.push(`🎯 <b>Focus Service:</b> ${parsedDemand.focusService}`);
      if (parsedDemand.delayedProject) confirmParts.push(`⚠️ <b>Delayed Project:</b> ${parsedDemand.delayedProject}`);
      if (parsedDemand.nextSteps) confirmParts.push(`➡️ <b>Next Steps:</b> ${parsedDemand.nextSteps}`);
    }
    if (parsedDemand.note) {
      confirmParts.push("");
      confirmParts.push("━━━━━━━━━━━━━━━━━━━━");
      confirmParts.push(`📋 <b>မှတ်စု/အကြောင်းအရာ:</b>\n<i>${parsedDemand.note}</i>`);
    }

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
