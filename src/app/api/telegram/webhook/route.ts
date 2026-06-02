import { prisma } from "@/lib/prisma";
import {
  isReportType,
  parseDemandMessageWithGemini,
  REPORT_TYPES,
  type ReportType,
} from "@/lib/demand-parser";
import { NextRequest, NextResponse } from "next/server";

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  daily_report: "Daily Report / Progress",
  customer_follow_up: "Customer Follow-up Notes",
};

function displayNameFromTelegramUser(from: { first_name?: string; last_name?: string }) {
  return [from.first_name, from.last_name].filter(Boolean).join(" ");
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
  showCategoryButtons = false,
}: {
  botToken: string | null | undefined;
  chatId: bigint | number;
  text: string;
  showCategoryButtons?: boolean;
}) {
  if (!botToken) return;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId.toString(),
      text,
      ...(showCategoryButtons
        ? {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: "Daily Report / Progress", callback_data: "report_type:daily_report" },
                  { text: "Customer Follow-up Notes", callback_data: "report_type:customer_follow_up" },
                ],
              ],
            },
          }
        : {}),
    }),
  });
}

async function answerCallbackQuery(botToken: string | null | undefined, callbackQueryId: string, text: string) {
  if (!botToken) return;

  await fetch(`https://api.telegram.org/bot${botToken}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callback_query_id: callbackQueryId,
      text,
    }),
  });
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

function categoryPrompt(reportType: ReportType) {
  if (reportType === REPORT_TYPES.DAILY_REPORT) {
    return [
      "Daily Report / Progress ရွေးထားပါတယ်။",
      "",
      "ဒီ format နဲ့ပို့လို့ရပါတယ်:",
      "ပြီးသွားတာ:",
      "လုပ်နေဆဲ:",
      "အခက်အခဲ:",
      "မနက်ဖြန် plan:",
    ].join("\n");
  }

  return [
    "Customer Follow-up Notes ရွေးထားပါတယ်။",
    "",
    "ဒီ format နဲ့ပို့လို့ရပါတယ်:",
    "Customer:",
    "Note:",
    "Pending:",
    "Next follow-up:",
  ].join("\n");
}

export async function POST(req: NextRequest) {

  try {
    const body = await req.json();
    const settings = await getActiveBotSettings();
    const callbackQuery = body.callback_query;

    if (callbackQuery?.data?.startsWith("report_type:") && callbackQuery.from) {
      const selectedType = callbackQuery.data.replace("report_type:", "");
      if (!isReportType(selectedType)) {
        return NextResponse.json({ ok: true });
      }

      const sender = await upsertSender(callbackQuery.from);
      await prisma.telegramSender.update({
        where: { id: sender.id },
        data: { activeReportType: selectedType },
      });

      await answerCallbackQuery(
        settings?.botToken,
        callbackQuery.id,
        `${REPORT_TYPE_LABELS[selectedType]} selected`
      );

      const chatId = callbackQuery.message?.chat?.id;
      if (chatId) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId: BigInt(chatId),
          text: categoryPrompt(selectedType),
        });
      }

      return NextResponse.json({ ok: true });
    }

    const message = body.message;

    // Only process text messages
    if (!message || !message.text) {
      return NextResponse.json({ ok: true });
    }

    const from = message.from;
    if (!from) {
      return NextResponse.json({ ok: true });
    }

    const sender = await upsertSender(from);

    if (message.text === "/start" || message.text === "/category") {
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId: BigInt(message.chat.id),
        text: "ဘာ data ဖြည့်ချင်ပါသလဲ?",
        showCategoryButtons: true,
      });
      return NextResponse.json({ ok: true });
    }

    const receivedAt = new Date(message.date * 1000);
    const updatedSender = await prisma.telegramSender.update({
      where: { id: sender.id },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });
    const reportType = isReportType(updatedSender.activeReportType)
      ? updatedSender.activeReportType
      : REPORT_TYPES.CUSTOMER_FOLLOW_UP;
    const parsedDemand = await parseDemandMessageWithGemini({
      text: message.text,
      receivedAt,
      reportType,
      apiKey: settings?.geminiApiKey,
      model: settings?.geminiModel,
    });

    await prisma.telegramMessage.create({
      data: {
        telegramMsgId: message.message_id,
        text: message.text,
        senderId: sender.id,
        chatId: BigInt(message.chat.id),
        chatTitle: message.chat.title || null,
        receivedAt,
        demandRecord: {
          create: {
            senderId: sender.id,
            reportType: parsedDemand.reportType,
            customerName: parsedDemand.customerName,
            category: parsedDemand.category,
            status: parsedDemand.status,
            note: parsedDemand.note,
            followUpDate: parsedDemand.followUpDate,
            confidence: parsedDemand.confidence,
            aiProvider: parsedDemand.aiProvider,
            aiModel: parsedDemand.aiModel,
          },
        },
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    // Always return 200 to Telegram to prevent retries
    return NextResponse.json({ ok: true });
  }
}
