import { prisma } from "@/lib/prisma";
import {
  isReportType,
  parseDemandMessageWithGemini,
  answerQuestionWithGemini,
  REPORT_TYPES,
  type ReportType,
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
    [{ text: "\ud83e\udd16 Q & A", callback_data: "mode:qa" }],
    [{ text: "\ud83d\udcca Reports", callback_data: "mode:reports" }],
  ],
};

const REPORT_TYPE_BUTTONS = {
  inline_keyboard: [
    [{ text: "\ud83d\udcc8 Business Report", callback_data: "report_type:business_report" }],
    [{ text: "\ud83d\udd2e Future Plan Report", callback_data: "report_type:future_plan" }],
    [{ text: "\u2b05\ufe0f Back", callback_data: "mode:back" }],
  ],
};

function getFormatPrompt(reportType: ReportType): string {
  if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
    return [
      "<b>\ud83d\udcc8 Business Report</b> \u101b\u103d\u1031\u1038\u1011\u102c\u1038\u1015\u102b\u1010\u101a\u103a\u104b",
      "",
      "\u1012\u102e format \u1014\u1032\u1037\u1015\u102d\u102f\u1037\u101c\u102d\u102f\u1037\u101b\u1015\u102b\u1010\u101a\u103a:",
      "Total Sales: (\u101b\u1031\u102c\u1004\u103a\u1038\u101b\u1004\u103d\u1031)",
      "Demand: (demand \u1021\u101b\u1031\u1021\u1010\u103d\u1000\u103a)",
      "Service: (\u1014\u102c\u1019\u100a\u103a) - Amount: (\u1004\u103d\u1031) - Qty: (\u1021\u101b\u1031\u1021\u1010\u103d\u1000\u103a)",
      "Appointments: (\u1001\u103b\u102d\u1014\u103a\u1038\u1006\u102d\u102f\u1019\u103e\u102f \u1021\u101b\u1031\u1021\u1010\u103d\u1000\u103a)",
      "Project: (\u1014\u102c\u1019\u100a\u103a) - Status: (on_track/delayed/completed)",
      "Marketing Budget: (\u1000\u102f\u1014\u103a\u1000\u103b\u1005\u101b\u102d\u1010\u103a)",
      "",
      "\u1019\u103e\u1010\u103a\u1001\u103b\u1000\u103a: \u1019\u101c\u102d\u102f\u1010\u102c\u1010\u103d\u1031 \u1001\u103b\u1014\u103a\u1011\u102c\u1038\u101c\u102d\u102f\u1037\u101b\u1015\u102b\u1010\u101a\u103a\u104b",
    ].join("\n");
  }

  return [
    "<b>\ud83d\udd2e Future Plan Report</b> \u101b\u103d\u1031\u1038\u1011\u102c\u1038\u1015\u102b\u1010\u101a\u103a\u104b",
    "",
    "\u1012\u102e format \u1014\u1032\u1037\u1015\u102d\u102f\u1037\u101c\u102d\u102f\u1037\u101b\u1015\u102b\u1010\u101a\u103a:",
    "Follow-up: (client \u1014\u102c\u1019\u100a\u103a) - Reason: (\u1018\u102c\u1000\u103c\u1031\u102c\u1004\u103a\u1037)",
    "Focus Service: (service \u1014\u102c\u1019\u100a\u103a) - Reason: (\u1018\u102c\u1000\u103c\u1031\u102c\u1004\u103a\u1037)",
    "Delayed Project: (project \u1014\u102c\u1019\u100a\u103a) - Reason: (\u1018\u102c\u1000\u103c\u1031\u102c\u1004\u103a\u1037)",
    "Next Steps: (\u1018\u102c\u1010\u103d\u1031\u1006\u1000\u103a\u101c\u102f\u1015\u103a\u1019\u101c\u1032)",
    "",
    "\u1019\u103e\u1010\u103a\u1001\u103b\u1000\u103a: \u1019\u101c\u102d\u102f\u1010\u102c\u1010\u103d\u1031 \u1001\u103b\u1014\u103a\u1011\u102c\u1038\u101c\u102d\u102f\u1037\u101b\u1015\u102b\u1010\u101a\u103a\u104b",
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
              "\ud83e\udd16 <b>Q & A Mode</b>",
              "",
              "\u1019\u1031\u1038\u1001\u103b\u1004\u103a\u1010\u102c\u1000\u102d\u102f \u101b\u102d\u102f\u1000\u103a\u101b\u102d\u102f\u1000\u103a\u101b\u103e\u102c\u101b\u103e\u102c \u1019\u1031\u1038\u101c\u102d\u102f\u1000\u103a\u1015\u102b\u104b",
              "\u101b\u103e\u102d\u1015\u103c\u102e\u1038\u101e\u102c\u1038 business data \u1010\u103d\u1031\u1021\u1015\u1031\u102b\u103a\u1019\u103e\u102c AI \u1000 \u1016\u103c\u1031\u1015\u1031\u1038\u1015\u102b\u1019\u101a\u103a\u104b",
              "",
              "\ud83d\udcdd \u101b\u100a\u103a\u100a\u103d\u103e\u1014\u103a\u1038\u1005\u102c \u101e\u102d\u1019\u103a\u1038\u1011\u102c\u1038\u1001\u103b\u1004\u103a\u101b\u1004\u103a /feed command \u101e\u102f\u1036\u1038\u1015\u102b\u104b",
              "\u1019\u1014\u1030\u1038\u101e\u102d\u102f\u1037 \u1015\u103c\u1014\u103a\u101e\u103d\u102c\u1038\u1001\u103b\u1004\u103a\u101b\u1004\u103a /start \u1014\u103e\u102d\u1015\u103a\u1015\u102b\u104b",
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
            text: "\ud83d\udcca <b>Reports</b>\n\n\u1018\u101a\u103a report \u1021\u1019\u103b\u102d\u102f\u1038\u1021\u1005\u102c\u1038 \u101b\u103d\u1031\u1038\u1001\u103b\u1004\u103a\u1015\u102b\u101e\u101c\u1032\u104b",
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
            text: "\ud83d\udc4b \u1018\u102c\u101c\u102f\u1015\u103a\u1001\u103b\u1004\u103a\u1015\u102b\u101e\u101c\u1032\u104b",
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

    // ─── Handle Text Messages ─────────────────────────────────────────
    const message = body.message;
    if (!message || !message.text) {
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
        text: "\ud83d\udc4b <b>\u1019\u1004\u103a\u1039\u1002\u101c\u102c\u1015\u102b!</b>\n\n\u1018\u102c\u101c\u102f\u1015\u103a\u1001\u103b\u1004\u103a\u1015\u102b\u101e\u101c\u1032\u104b",
        replyMarkup: MAIN_MENU_BUTTONS,
      });
      return NextResponse.json({ ok: true });
    }

    // /feed command → Store Q&A document
    if (message.text.startsWith('/feed ')) {
      const content = message.text.slice(6).trim();
      if (content.length < 5) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: "\u26a0\ufe0f \u1005\u102c\u101e\u102c\u1038 \u1010\u102d\u102f\u1010\u102d\u102f\u1015\u102d\u102f\u1037\u101b\u103e\u100a\u103a\u1015\u102b\u104b\n\n/feed [\u1005\u102c\u101e\u102c\u1038] \u1015\u102f\u1036\u1005\u1036\u1014\u1032\u1037 \u1015\u102d\u102f\u1037\u1015\u102b\u104b",
        });
        return NextResponse.json({ ok: true });
      }

      const title = content.slice(0, 50) + (content.length > 50 ? '...' : '');
      await prisma.qADocument.create({
        data: {
          title,
          content,
          source: 'telegram',
          senderId: sender.id,
        },
      });

      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: `\u2705 \u101e\u102d\u1019\u103a\u1038\u1011\u102c\u1038\u1015\u103c\u102e\u1038\u1015\u102b\u1015\u103c\u102e!\n\n\ud83d\udcc4 <b>${title}</b>\n\nQ & A mode \u1019\u103e\u102c \u1012\u102e data \u1000\u102d\u102f \u101e\u102f\u1036\u1038\u1015\u103c\u102e\u1038 \u1016\u103c\u1031\u1015\u1031\u1038\u1015\u102b\u1019\u101a\u103a\u104b`,
      });
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
          text: "\u26a0\ufe0f Gemini API key \u1019\u101b\u103e\u102d\u101e\u1031\u1038\u1015\u102b\u104b Settings \u1019\u103e\u102c \u1011\u100a\u103a\u1037\u1015\u102b\u104b",
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
        text: `\ud83e\udd16 ${answer}`,
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
        demandRecord: {
          create: {
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
        },
      },
    });

    // Confirmation message
    const confirmParts = ['\u2705 <b>\u1019\u103e\u1010\u103a\u1015\u103c\u102e\u1038\u1015\u102b\u1015\u103c\u102e!</b>'];
    if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
      confirmParts.push(`\ud83d\udcca Report Type: Business Report`);
      if (parsedDemand.totalSales) confirmParts.push(`\ud83d\udcb0 Total Sales: ${parsedDemand.totalSales.toLocaleString()}`);
      if (parsedDemand.demand) confirmParts.push(`\ud83d\udcc8 Demand: ${parsedDemand.demand}`);
      if (parsedDemand.serviceName) confirmParts.push(`\ud83d\udee0\ufe0f Service: ${parsedDemand.serviceName}`);
      if (parsedDemand.appointments) confirmParts.push(`\ud83d\udcc5 Appointments: ${parsedDemand.appointments}`);
      if (parsedDemand.projectName) confirmParts.push(`\ud83d\udcc1 Project: ${parsedDemand.projectName} (${parsedDemand.projectStatus || 'new'})`);
      if (parsedDemand.marketingBudget) confirmParts.push(`\ud83d\udcb8 Marketing: ${parsedDemand.marketingBudget.toLocaleString()}`);
    } else {
      confirmParts.push(`\ud83d\udd2e Report Type: Future Plan`);
      if (parsedDemand.followUpClient) confirmParts.push(`\ud83d\udc64 Follow-up: ${parsedDemand.followUpClient}`);
      if (parsedDemand.focusService) confirmParts.push(`\ud83c\udfaf Focus: ${parsedDemand.focusService}`);
      if (parsedDemand.delayedProject) confirmParts.push(`\u26a0\ufe0f Delayed: ${parsedDemand.delayedProject}`);
      if (parsedDemand.nextSteps) confirmParts.push(`\u27a1\ufe0f Next: ${parsedDemand.nextSteps}`);
    }
    confirmParts.push(`\n\ud83d\udccb ${parsedDemand.note}`);

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
