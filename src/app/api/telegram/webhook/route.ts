import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import * as XLSX from "xlsx";
import {
  parseDemandMessageWithGemini,
  answerQuestionWithGemini,
  extractDataFromFile,
  isFileTooLarge,
  isProjectExpiryHeaders,
  isProjectServiceTrackingHeaders,
  parseProjectExpirySpreadsheet,
  isWebsiteUpdateHeaders,
  parseWebsiteUpdateSpreadsheet,
  isBusinessReportHeaders,
  parseBusinessReportSpreadsheet,
  parseProjectExpiryMessageWithGemini,
  parseWebsiteUpdateMessageWithGemini,
  parseBusinessReportWithGemini,
  parseExcelDate,
  type ParsedDemandRecord,
  type ParsedProjectExpiration,
  type ParsedWebsiteUpdate,
  type ParsedBusinessReport,
} from "@/lib/demand-parser";
import { analyzeDemandRecord } from "@/lib/demand-analysis";
import { NextRequest, NextResponse, after } from "next/server";
import { sendOTPEmail } from "@/lib/email";
import { notDeleted, restoreData } from "@/lib/soft-delete";
import { formatPhoneNumber } from "@/lib/utils";
import type { TelegramSender } from "@/generated/prisma/client";

type FinanceRecord = {
  date: Date;
  description: string;
  category: string;
  type: string;
  amount: number;
  paymentMethod: string;
  reference: string;
  notes: string;
  financeRecordType?: string;
  status?: string;
  counterparty?: string;
  dueDate?: Date | null;
  voucherNumber?: string;
  accountingSection?: string;
};

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

async function getActiveBotSettings(req: NextRequest) {
  const secret = req.headers.get('x-telegram-bot-api-secret-token');
  if (!secret) return null;

  // Each configured bot has a distinct Telegram webhook secret. Never fall
  // back to an arbitrary active bot: a request without a valid secret is not
  // a Telegram webhook request.
  return prisma.botSettings.findFirst({
    where: { isActive: true, webhookSecret: secret },
    select: {
      userId: true,
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
}): Promise<{ message_id: number } | null> {
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

async function copyTelegramMessage({
  botToken,
  fromChatId,
  toChatId,
  messageId,
}: {
  botToken: string | null | undefined;
  fromChatId: bigint | number;
  toChatId: bigint | number;
  messageId: string | number;
}) {
  if (!botToken) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/copyMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: toChatId.toString(),
        from_chat_id: fromChatId.toString(),
        message_id: Number(messageId),
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('Error copying Telegram message for data approval:', err);
    return false;
  }
}

async function sendTelegramDocument({
  botToken,
  chatId,
  fileId,
  fileName,
}: {
  botToken: string | null | undefined;
  chatId: bigint | number;
  fileId: string;
  fileName: string;
}) {
  if (!botToken) return false;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendDocument`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        document: fileId,
        caption: `📎 File for approval: ${fileName}`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error('Error sending approval file to data approver:', err);
    return false;
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
}): Promise<boolean> {
  if (!botToken) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.toString(),
        message_id: messageId,
        text,
        parse_mode: "HTML",
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
      }),
    });
    if (!res.ok) {
      console.error("Error editing Telegram message:", await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error editing Telegram message:", err);
    return false;
  }
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
  const doc = message.document as Record<string, unknown> | undefined;
  if (doc) {
    return {
      fileId: doc.file_id as string,
      fileName: (doc.file_name as string) || 'document',
      mimeType: (doc.mime_type as string) || 'application/octet-stream',
      fileSize: (doc.file_size as number) || 0,
    };
  }

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

  const audio = message.audio as Record<string, unknown> | undefined;
  if (audio) {
    return {
      fileId: audio.file_id as string,
      fileName: (audio.file_name as string) || 'audio',
      mimeType: (audio.mime_type as string) || 'audio/mpeg',
      fileSize: (audio.file_size as number) || 0,
    };
  }

  const voice = message.voice as Record<string, unknown> | undefined;
  if (voice) {
    return {
      fileId: voice.file_id as string,
      fileName: 'voice.ogg',
      mimeType: (voice.mime_type as string) || 'audio/ogg',
      fileSize: (voice.file_size as number) || 0,
    };
  }

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
}, ownerUserId: string | null | undefined) {
  const displayName = displayNameFromTelegramUser(from);

  const existing = await prisma.telegramSender.findFirst({
    where: {
      telegramUserId: BigInt(from.id),
      userId: ownerUserId || null,
    },
  });

  if (!existing) {
    return prisma.telegramSender.create({
      data: {
        telegramUserId: BigInt(from.id),
        firstName: from.first_name || "Unknown",
        lastName: from.last_name || null,
        username: from.username || null,
        displayName: displayName || "Unknown",
        messageCount: 0,
        lastMessageAt: null,
        activeReportType: 'none',
        userId: ownerUserId || null,
      },
    });
  }

  return prisma.telegramSender.update({
    where: { id: existing.id },
    data: {
      firstName: from.first_name || "Unknown",
      lastName: from.last_name || null,
      username: from.username || null,
      displayName: displayName || "Unknown",
      ...(ownerUserId ? { userId: ownerUserId } : {}),
    },
  });
}

const MAIN_MENU_BUTTONS = {
  inline_keyboard: [
    [{ text: "🤖 Q&A မေးမြန်း", callback_data: "mode:qa" }, { text: "📈 Sales & Marketing", callback_data: "mode:demand_report" }],
    [{ text: "🎧 Customer Service", callback_data: "mode:customer_service" }, { text: "💳 Finance Transactions", callback_data: "mode:finance_transactions" }],
    [{ text: "🧩 Project & Service Tracking", callback_data: "mode:project_service_tracking" }],
    [{ text: "📊 Business KPI Report", callback_data: "mode:business_report" }],
  ],
};

const KEYBOARD_UNLINKED = {
  keyboard: [
    [{ text: "/link" }]
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

const KEYBOARD_LINKED = {
  keyboard: [
    [{ text: "/menu" }, { text: "/pending" }],
    [{ text: "/format" }, { text: "/template" }],
    [{ text: "/unlink" }]
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

function truncateTelegramLabel(value: string, maxLength = 24) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function getPlainTemplateTextForMode(mode: string | null | undefined): string {
  switch (mode) {
    case 'customer_service':
      return [
        "Date:",
        "Customer Name:",
        "Company:",
        "Phone:",
        "Email:",
        "Purchased Service:",
        "Purchase Amount MMK:",
        "Status:",
        "Next Follow Up:",
        "CSAT:",
        "Last Contact Note:",
      ].join("\n");
    case 'project_expiry':
      return [
        "Date:",
        "Check List:",
        "URL:",
        "Package:",
        "Domain Provider:",
        "Hosting Provider:",
        "Hosting Remark:",
        "Domain Expiration Date:",
        "Hosting Expiration Date:",
        "Remark:",
      ].join("\n");
    case 'website_update':
      return [
        "Date:",
        "Project Name:",
        "Website Link:",
        "Business Type:",
        "Package Name:",
        "Status:",
        "Remark:",
      ].join("\n");
    case 'project_service_tracking':
      return [
        "Record Date:",
        "Project Name:",
        "Website Link:",
        "Business Type:",
        "Package Name:",
        "Domain Provider:",
        "Hosting Provider:",
        "Hosting Remark:",
        "Domain Expiration Date:",
        "Hosting Expiration Date:",
        "Offer Expiry / Renewal Date:",
        "Project Status:",
        "Expiry / Service Remark:",
        "Update Status:",
        "Update Remark:",
      ].join("\n");
    case 'finance_transactions':
      return [
        "Date:",
        "Description:",
        "Category:",
        "Type:",
        "Amount (MMK):",
        "Payment Method:",
        "Reference:",
        "Notes:",
      ].join("\n");
    case 'business_report':
      return [
        "Date:",
        "Reporter:",
        "Marketing Budget:",
        "Marketing Channel:",
        "Calls Made:",
        "Appointments Made:",
        "Appointments Kept:",
        "New Leads:",
        "Total Sales Amount:",
        "Closed Deals:",
        "Pending Deals:",
        "Notes:",
      ].join("\n");
    case 'demand_report':
    default:
      return [
        "Date:",
        "Customer Name:",
        "Phone:",
        "Company:",
        "Service Name:",
        "Service Amount:",
        "Service Qty:",
        "Follow-up Date:",
        "Note:",
      ].join("\n");
  }
}

function buildFormatInlineButtons(mode: string | null | undefined) {
  return {
    inline_keyboard: [
      [
        { text: "📋 Template ကြည့်ရန်", callback_data: "action:template" },
        { text: "↩️ Main Menu", callback_data: "action:menu" },
      ],
    ],
  };
}

function buildMainMenuButtons(allowedDepartments: string[]) {
  const buttons: { text: string; callback_data: string }[][] = [];
  const row1: { text: string; callback_data: string }[] = [];
  const row2: { text: string; callback_data: string }[] = [];
  const row3: { text: string; callback_data: string }[] = [];
  const row4: { text: string; callback_data: string }[] = [];

  if (allowedDepartments.includes('QA')) {
    row1.push({ text: "🤖 Q&A မေးမြန်း", callback_data: "mode:qa" });
  }
  if (allowedDepartments.includes('Sales')) {
    row1.push({ text: "📈 Sales & Marketing", callback_data: "mode:demand_report" });
    row2.push({ text: "🎧 Customer Service", callback_data: "mode:customer_service" });
  }
  if (allowedDepartments.includes('IT')) {
    row3.push({ text: "🧩 Project & Service Tracking", callback_data: "mode:project_service_tracking" });
  }
  if (allowedDepartments.includes('Finance')) {
    row2.push({ text: "💳 Finance Transactions", callback_data: "mode:finance_transactions" });
    row4.push({ text: "📊 Business KPI Report", callback_data: "mode:business_report" });
  }

  if (row1.length) buttons.push(row1);
  if (row2.length) buttons.push(row2);
  if (row3.length) buttons.push(row3);
  if (row4.length) buttons.push(row4);

  return { inline_keyboard: buttons };
}

function getDepartmentForMode(mode: string): string | null {
  if (mode === 'demand_report' || mode === 'customer_service') return 'Sales';
  if (mode === 'project_expiry' || mode === 'website_update' || mode === 'project_service_tracking') return 'IT';
  if (mode === 'business_report' || mode === 'finance_transactions') return 'Finance';
  if (mode === 'qa') return 'QA';
  return null;
}

function normalizeTelegramReportMode(mode: string): string {
  // Project expiry and website update are views within the combined tracking
  // workflow, not separate Telegram data-entry modes.
  return mode === 'project_expiry' || mode === 'website_update'
    ? 'project_service_tracking'
    : mode;
}

function getDepartmentNameBurmese(dep: string): string {
  if (dep === 'Sales') return 'Sales & Marketing (အရောင်းနှင့်စျေးကွက်)';
  if (dep === 'IT') return 'IT & Projects (စီမံကိန်းနှင့် အိုင်တီ)';
  if (dep === 'Finance') return 'Finance & Operations (ဘဏ္ဍာရေးနှင့် လုပ်ငန်းဆောင်ရွက်မှု)';
  if (dep === 'QA') return 'QA / Support (အမေးအဖြေ)';
  return dep;
}

async function sendNoPermissionPrompt(
  botToken: string | null | undefined,
  chatId: bigint | number,
  departmentName: string
) {
  await sendTelegramMessage({
    botToken,
    chatId,
    text: [
      "🚫 ━━━━━━━━━━━━━━━━━━━━",
      "",
      `  <b>ဝင်ရောက်ခွင့် မရှိပါ</b>`,
      "",
      "━━━━━━━━━━━━━━━━━━━━",
      "",
      `📌 <b>ဌာန:</b>  ${getDepartmentNameBurmese(departmentName)}`,
      "",
      `သင်သည် ယခုဌာနအတွက် ဒေတာပေးပို့ရန်`,
      `ခွင့်ပြုချက် မရရှိသေးပါ။`,
      "",
      "💡 <i>ကျေးဇူးပြု၍ လုပ်ငန်းတာဝန်ရှိသူ</i>",
      "<i>(Business Owner) အား ဆက်သွယ်ပါ။</i>",
    ].join("\n"),
    replyMarkup: {
      inline_keyboard: [
        [{ text: "↩️ Main Menu", callback_data: "action:menu" }]
      ]
    }
  });
}

async function checkAuthorization(
  sender: Pick<TelegramSender, "isVerified" | "isAuthorized" | "id" | "email" | "otpExpiresAt">,
  botToken: string | null | undefined,
  chatId: bigint | number
): Promise<boolean> {
  if (sender.isVerified && sender.isAuthorized) {
    return true;
  }

  if (!sender.isVerified) {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: [
        "👋 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Business AI Integration</b>",
        "  <i>စနစ်မှ လှိုက်လှဲစွာ ကြိုဆိုပါသည်</i>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စနစ်ကို သုံးနိုင်ရန် အီးမေးလ်ဖြင့်",
        "အကောင့် အရင်ဆုံး ချိတ်ဆက်ရပါမည်။",
        "",
        "📝 <b>လုပ်ဆောင်ရန်:</b>",
        "",
        "  ① အောက်ခြေရှိ <b>/link</b> ခလုတ်ကို နှိပ်ပါ",
        "  ② သင့် ဝန်ထမ်းအီးမေးလ်ကို ရိုက်ထည့်ပါ",
        "  ③ ရရှိလာသော အီးမေးလ် OTP ကုဒ်ကို ရိုက်ထည့်ပါ",
      ].join("\n"),
      replyMarkup: KEYBOARD_UNLINKED,
    });
    return false;
  }

  if (!sender.isAuthorized) {
    await sendTelegramMessage({
      botToken,
      chatId,
      text: [
        "⏳ ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>ခွင့်ပြုချက် စောင့်ဆိုင်းနေပါသည်</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        `✅ အီးမေးလ်: <code>${sender.email}</code>`,
        "   (အတည်ပြုပြီး)",
        "",
        "🔄 Business Owner ၏ ခွင့်ပြုချက်ကို",
        "   စောင့်ဆိုင်းနေပါသည်...",
        "",
        "💡 <i>သင့်လုပ်ငန်း တာဝန်ရှိသူအား</i>",
        "<i>ဆက်သွယ်ပြီး ခွင့်ပြုချက် တောင်းဆိုပါ။</i>",
      ].join("\n"),
      replyMarkup: KEYBOARD_UNLINKED, // keep unlinked status or allow unlink
    });
    return false;
  }

  return false;
}

// Sent when a sender submits data without first picking a report mode.
// Prevents data from being mis-filed into the wrong report type.
async function sendPickModePrompt(
  botToken: string | null | undefined,
  chatId: bigint,
) {
  await sendTelegramMessage({
    botToken,
    chatId,
    text: [
      "👋 <b>ကဏ္ဍ ရွေးချယ်ရန် လိုအပ်ပါသည်။</b>",
      "",
      "အချက်အလက် မထည့်သွင်းမီ မည်သည့် လုပ်ငန်းစဉ်အမျိုးအစားဖြင့် ဆောင်ရွက်မည်ကို အောက်ပါ Menu မှ ဦးစွာ ရွေးချယ်ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
      "",
      "ရွေးချယ်ပြီးမှသာ ပေးပို့သော အချက်အလက်များကို မှန်ကန်သော ကဏ္ဍတွင် သိမ်းဆည်းပေးနိုင်မည် ဖြစ်ပါသည်။",
    ].join("\n"),
    replyMarkup: MAIN_MENU_BUTTONS,
  });
}

function getFormatPrompt(): string {
  return [
    "📈 ━━━━━━━━━━━━━━━━━━━━",
    "",
    "  <b>Sales & Marketing Mode</b>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel/CSV",
    "    ဖိုင်ကို တိုက်ရိုက်ပို့နိုင်ပါသည်",
    "",
    "📝 <b>စာသားတစ်စောင် = record တစ်ခု</b>။ အောက်ကစာကို Copy ကူးပြီး colon နောက်မှာ value ဖြည့်ပါ။",
    "<pre>",
    "Date: 2026-06-01",
    "Customer Name: Aung Kyaw Moe",
    "Phone: 0995011222",
    "Company: Mandalay Plaza",
    "Service Name: Website Gold Package",
    "Service Amount: 1500000",
    "Service Qty: 1",
    "Follow-up Date: 2026-06-05",
    "Note: Requires custom design",
    "</pre>",
    "",
    "💡 <i>မလိုအပ်သော စာကြောင်းများ ချန်လှပ်ထားနိုင်ပါသည်</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function getCustomerServiceFormatPrompt(): string {
  return [
    "🎧 ━━━━━━━━━━━━━━━━━━━━",
    "",
    "  <b>Customer Service Mode</b>",
    "  <i>ဝယ်ယူပြီး customer service / follow-up မှတ်တမ်း</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel/CSV",
    "    ဖိုင်ကို တိုက်ရိုက်ပို့နိုင်ပါသည်",
    "",
    "📝 <b>စာသားတစ်စောင် = record တစ်ခု</b>။ <code>Date</code>, <code>Customer Name</code>, <code>Purchased Service</code> နှင့် <code>Purchase Amount MMK</code> ကို မဖြစ်မနေဖြည့်ပါ။",
    "<pre>",
    "Date: 2026-06-02",
    "Customer Name: Aung Kyaw Moe",
    "Company: Mandalay Plaza",
    "Phone: 0995011222",
    "Email: aung@example.com",
    "Purchased Service: Website Gold Package",
    "Purchase Amount MMK: 1500000",
    "Status: closed",
    "Next Follow Up: 2026-06-25",
    "CSAT: 5",
    "Last Contact Note: Project kicked off",
    "</pre>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function getProjectExpiryFormatPrompt(): string {
  return [
    "⏰ ━━━━━━━━━━━━━━━━━━━━",
    "",
    "  <b>Project Expiry Mode</b>",
    "  <i>စီမံကိန်း သက်တမ်းကုန်ဆုံးမှု</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel ဖိုင်",
    "    ပေးပို့နိုင်ပါသည်",
    "",
    "📝 <b>စာသားပုံစံ:</b>",
    "<pre>",
    "• Date: [YYYY-MM-DD]",
    "• Check List: [Project/Checklist အမည်]",
    "• URL: [Website URL]",
    "• Package: [Package]",
    "• Domain Provider: [Provider]",
    "• Hosting Provider: [Provider]",
    "• Hosting Remark: [မှတ်ချက်]",
    "• Domain Expiration Date: [YYYY-MM-DD]",
    "• Hosting Expiration Date: [YYYY-MM-DD]",
    "• Remark: [မှတ်ချက်]",
    "</pre>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function getWebsiteUpdateFormatPrompt(): string {
  return [
    "🔧 ━━━━━━━━━━━━━━━━━━━━",
    "",
    "  <b>Website Update Mode</b>",
    "  <i>ဝဘ်ဆိုဒ် အပ်ဒိတ်/ထိန်းသိမ်းမှု</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel ဖိုင်",
    "    ပေးပို့နိုင်ပါသည်",
    "",
    "📝 <b>စာသားပုံစံ:</b>",
    "<pre>",
    "• Date: [YYYY-MM-DD]",
    "• Project Name: [Project/Website အမည်]",
    "• Website Link: [Website URL]",
    "• Business Type: [လုပ်ငန်းအမျိုးအစား]",
    "• Package Name: [Package]",
    "• Status: [up_to_date / pending / in_progress]",
    "• Remark: [မှတ်ချက်]",
    "</pre>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function getProjectServiceTrackingFormatPrompt(): string {
  return [
    "🧩 ━━━━━━━━━━━━━━━━━━━━",
    "",
    "  <b>Project &amp; Service Tracking Mode</b>",
    "  <i>Project expiry, offer renewal, website update နှင့် maintenance</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel ဖိုင်",
    "    တစ်ခုတည်းဖြင့် Project နှင့် Website records ကို တင်သွင်းနိုင်ပါသည်",
    "",
    "📝 <b>စာသားတစ်စောင် = Project + Website record တစ်ခု</b>။ မသက်ဆိုင်သော field များကို ချန်ထားနိုင်ပါသည်။",
    "<pre>",
    "Record Date: 2026-06-01",
    "Project Name: Mandalay Plaza Site",
    "Website Link: mandalayplaza.com",
    "Business Type: Retail & Mall",
    "Package Name: Website Gold Package",
    "Domain Provider: Namecheap",
    "Hosting Provider: DigitalOcean",
    "Hosting Remark: 2GB Droplet",
    "Domain Expiration Date: 2026-06-28",
    "Hosting Expiration Date: 2026-07-05",
    "Offer Expiry / Renewal Date: 2026-07-01",
    "Project Status: active",
    "Expiry / Service Remark: Renew early",
    "Update Status: in_progress",
    "Update Remark: Adding promo banner",
    "</pre>",
    "",
    "💡 <i>မလိုအပ်သော စာကြောင်းများ ချန်လှပ်ထားနိုင်ပါသည်</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function getFinanceTransactionsFormatPrompt(): string {
  return [
    "💳 ━━━━━━━━━━━━━━━━━━━━",
    "",
    "  <b>Finance Transactions Mode</b>",
    "  <i>ငွေဝင်/ငွေထွက် မှတ်တမ်း</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel/CSV",
    "    ဖိုင်ကို တိုက်ရိုက်ပို့နိုင်ပါသည်",
    "",
    "📝 <b>Required:</b> Date, Description, Type, Amount (MMK)။ Type ကို <code>Income</code> သို့မဟုတ် <code>Expense</code> ဟုသာရေးပါ။",
    "<pre>",
    "Date: 2026-06-01",
    "Description: Mandalay Plaza Downpayment",
    "Category: Service Revenue",
    "Type: Income",
    "Amount (MMK): 1500000",
    "Payment Method: Bank Transfer",
    "Reference: REC-0601",
    "Notes: Gold Package",
    "Finance Record Type: payment",
    "Status: paid",
    "Counterparty: Aung Kyaw Moe",
    "Due Date:",
    "Voucher Number: VCH-0601",
    "Accounting Section: Payments",
    "</pre>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

function getBusinessReportFormatPrompt(): string {
  return [
    "📊 ━━━━━━━━━━━━━━━━━━━━",
    "",
    "  <b>Business KPI Report Mode</b>",
    "  <i>လုပ်ငန်းလှုပ်ရှားမှု အစီရင်ခံစာ</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel ဖိုင်",
    "    ပေးပို့နိုင်ပါသည်",
    "",
    "📝 <b>စာသားတစ်စောင် = KPI report တစ်ခု</b>။ Amount များကို comma မပါဘဲ ဂဏန်းဖြင့်ရေးလျှင် ပိုရှင်းပါသည်။",
    "<pre>",
    "Date: 2026-06-05",
    "Reporter: Aung Zaw",
    "Marketing Budget: 150000",
    "Marketing Channel: Facebook",
    "Calls Made: 45",
    "Appointments Made: 12",
    "Appointments Kept: 9",
    "New Leads: 25",
    "Total Sales Amount: 2000000",
    "Closed Deals: 2",
    "Pending Deals: 4",
    "Notes: Good Messenger campaign response",
    "</pre>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// Return the full format guide for whatever report mode the sender is in.
function getFormatPromptForMode(mode: string | null | undefined): string {
  switch (mode) {
    case 'customer_service':
      return getCustomerServiceFormatPrompt();
    case 'project_expiry':
      return getProjectExpiryFormatPrompt();
    case 'website_update':
      return getWebsiteUpdateFormatPrompt();
    case 'project_service_tracking':
      return getProjectServiceTrackingFormatPrompt();
    case 'finance_transactions':
      return getFinanceTransactionsFormatPrompt();
    case 'business_report':
      return getBusinessReportFormatPrompt();
    case 'demand_report':
      return getFormatPrompt();
    default:
      return [
        "🤖 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Q&A Mode</b>",
        "  <i>AI မေးမြန်းခြင်း</i>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "ပုံစံ (format) မလိုအပ်ပါ",
        "သိရှိလိုသည်များကို တိုက်ရိုက်မေးပါ",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
      ].join("\n");
  }
}

// A compact footer reminding the sender of the expected fields for the
// current report mode. Appended to confirmation messages so users can see
// what to include next time without re-opening the menu.
function getFormatHintFooter(mode: string): string {
  let fields = "";
  if (mode === 'demand_report') {
    fields = "Date • Customer Name • Phone • Company • Service Name • Service Amount • Service Qty • Follow-up Date • Note";
  } else if (mode === 'customer_service') {
    fields = "Date • Customer Name • Company • Phone • Email • Purchased Service • Purchase Amount MMK • Status • Next Follow Up • CSAT • Last Contact Note";
  } else if (mode === 'project_expiry') {
    fields = "Date • Check List • URL • Package • Domain/Hosting • Remark";
  } else if (mode === 'website_update') {
    fields = "Date • Project Name • Website Link • Business Type • Package Name • Status • Remark";
  } else if (mode === 'project_service_tracking') {
    fields = "Record Date • Project • Website • Package • Domain/Hosting Expiry • Offer Renewal • Project Status • Update Status";
  } else if (mode === 'finance_transactions') {
    fields = "Date • Description • Category • Type • Amount (MMK) • Payment Method • Reference • Notes • Finance Record Type • Status • Counterparty • Due Date • Voucher Number";
  } else if (mode === 'business_report') {
    fields = "Date • Reporter • Marketing Budget • Marketing Channel • Calls • Appointments • Leads • Sales • Deals • Notes";
  }
  return [
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    `💡 <i>${fields}</i>`,
  ].join("\n");
}

function isFinanceRecordsHeaders(headers: string[]): boolean {
  const normalized = headers.map(h => String(h || '').trim().toLowerCase());
  return (
    normalized.includes('type') &&
    (normalized.includes('amount_mmk') || normalized.includes('amount (mmk)') || normalized.includes('amount')) &&
    (normalized.includes('description') || normalized.includes('category'))
  );
}

function normalizeMyanmarDigits(value: string): string {
  const digits: Record<string, string> = {
    '၀': '0', '၁': '1', '၂': '2', '၃': '3', '၄': '4',
    '၅': '5', '၆': '6', '၇': '7', '၈': '8', '၉': '9',
  };
  return value.replace(/[၀-၉]/g, (digit) => digits[digit] || digit);
}

function cleanTelegramFieldValue(value: string): string {
  return value
    .trim()
    // Staff commonly paste the template brackets. Accept a missing closing
    // bracket too, so a valid finance entry is never silently discarded.
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .trim();
}

/** Parse the Finance Transactions text template without treating it as a KPI report. */
function parseFinanceTransactionText(text: string, fallbackDate: Date): FinanceRecord | null {
  const fields = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^\s*(?:[•*-]|\d+[.)])\s*/, '').trim();
    const match = line.match(/^([^:=]+?)\s*[:=]\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    fields.set(key, cleanTelegramFieldValue(match[2]));
  }

  const value = (...keys: string[]) => {
    for (const key of keys) {
      const found = fields.get(key.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
      if (found) return found;
    }
    return '';
  };

  const amountText = normalizeMyanmarDigits(value('amount mmk', 'amount', 'value')).replace(/[,\s]/g, '');
  const amount = Number.parseFloat(amountText);
  const rawType = value('type', 'transaction type').toLowerCase();
  const type = /income|revenue|sale|ဝင်ငွေ/.test(rawType)
    ? 'Income'
    : /expense|cost|spend|ထွက်ငွေ/.test(rawType)
      ? 'Expense'
      : '';

  // An amount and transaction type are the minimum fields needed to create a
  // useful finance record. The rest of the template remains optional.
  if (!type || !Number.isFinite(amount) || amount <= 0) return null;

  const date = parseExcelDate(normalizeMyanmarDigits(value('date', 'record date'))) || fallbackDate;
  return {
    date,
    description: value('description', 'detail') || 'Telegram finance entry',
    category: value('category', 'accounting section') || (type === 'Income' ? 'Service Revenue' : 'Operating Expense'),
    type,
    amount,
    paymentMethod: value('payment method', 'payment'),
    reference: value('reference', 'reference number'),
    notes: value('notes', 'note', 'remark'),
    financeRecordType: value('finance record type', 'record type', 'accounting type') || undefined,
    status: value('status') || undefined,
    counterparty: value('counterparty', 'customer', 'vendor') || undefined,
    dueDate: parseExcelDate(normalizeMyanmarDigits(value('due date', 'due'))) || null,
    voucherNumber: value('voucher number', 'voucher no', 'voucher') || undefined,
    accountingSection: value('accounting section', 'section') || undefined,
  };
}


function parseFinanceRecordsSpreadsheet(fileBuffer: Buffer): FinanceRecord[] {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const allRecords: FinanceRecord[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { raw: true });
    for (const row of rows) {
      const getVal = (keys: string[]) => {
        const normalize = (s: string) => s.toLowerCase().trim().replace(/[_-]+/g, ' ');
        for (const k of keys) {
          const normalizedK = normalize(k);
          const matchedKey = Object.keys(row).find(
            rk => normalize(rk) === normalizedK
          );
          if (matchedKey !== undefined) return row[matchedKey];
        }
        return null;
      };

      const dateVal = getVal(['Date', 'date']);
      const dateObj = parseExcelDate(dateVal) || new Date();

      const desc = String(getVal(['Description', 'description', 'desc']) || '').trim();
      const category = String(getVal(['Category', 'category', 'cat']) || '').trim();
      const type = String(getVal(['Type', 'type']) || '').trim();
      const amountVal = getVal(['Amount (MMK)', 'amount_mmk', 'amount']);
      
      let amount = 0;
      if (amountVal != null) {
        const clean = String(amountVal).replace(/[\u1040-\u1049]/g, (d) => {
          const digits: Record<string, string> = {
            '\u1040': '0', '\u1041': '1', '\u1042': '2', '\u1043': '3', '\u1044': '4',
            '\u1045': '5', '\u1046': '6', '\u1047': '7', '\u1048': '8', '\u1049': '9',
          };
          return digits[d] || d;
        }).replace(/,/g, '');
        const n = parseFloat(clean);
        if (!isNaN(n)) amount = n;
      }

      const payMethod = String(getVal(['Payment Method', 'payment_method']) || '').trim();
      const ref = String(getVal(['Reference', 'reference']) || '').trim();
      const notes = String(getVal(['Notes', 'notes', 'note']) || '').trim();
      const financeRecordType = String(getVal(['Finance Record Type', 'finance_record_type', 'record type', 'accounting type']) || '').trim();
      const status = String(getVal(['Status', 'status']) || '').trim();
      const counterparty = String(getVal(['Counterparty', 'counterparty', 'party', 'customer', 'vendor']) || '').trim();
      const dueDate = parseExcelDate(getVal(['Due Date', 'due_date', 'due'])) || null;
      const voucherNumber = String(getVal(['Voucher Number', 'voucher_number', 'voucher no', 'invoice number', 'receipt number']) || '').trim();
      const accountingSection = String(getVal(['Accounting Section', 'accounting_section', 'section']) || '').trim();

      if (!type) continue;

      allRecords.push({
        date: dateObj,
        description: desc,
        category,
        type,
        amount,
        paymentMethod: payMethod,
        reference: ref,
        notes,
        financeRecordType,
        status,
        counterparty,
        dueDate,
        voucherNumber,
        accountingSection,
      });
    }
  }
  return allRecords;
}

function normalizeFinanceEntryType(rec: FinanceRecord): string {
  const explicitType = rec.financeRecordType?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const validTypes = new Set(["salary", "cogs", "operating_expense", "payment", "receivable", "debt", "voucher", "owner_capital"]);
  const recordType = rec.type.trim().toLowerCase();
  const isIncome = recordType === "income";
  const status = rec.status?.trim().toLowerCase();
  const section = rec.accountingSection?.trim().toLowerCase() ?? "";

  if (explicitType && validTypes.has(explicitType)) {
    if (isIncome && ["salary", "cogs", "operating_expense", "debt"].includes(explicitType)) {
      return status === "pending" || section.includes("receivable") || Boolean(rec.dueDate) ? "receivable" : "payment";
    }
    if (!isIncome && ["payment", "receivable"].includes(explicitType)) {
      return status === "pending" || Boolean(rec.dueDate) ? "debt" : "operating_expense";
    }
    return explicitType;
  }

  const category = rec.category.trim().toLowerCase();
  const title = rec.description.trim().toLowerCase();
  if (category.includes("owner capital") || category.includes("owner's capital") || title.includes("owner capital") || title.includes("initial investment")) return "owner_capital";
  if (category.includes("salary") || title.includes("salary") || title.includes("payroll")) return "salary";
  if (category.includes("cogs") || category.includes("cost of goods") || category.includes("cost of goods sold")) return "cogs";
  if (category.includes("receivable") || title.includes("receivable")) return "receivable";
  if (category.includes("debt") || category.includes("payable") || title.includes("debt") || title.includes("payable")) return "debt";
  if (category.includes("voucher") || title.includes("voucher")) return "voucher";
  if (rec.type.trim().toLowerCase() === "income") return "payment";
  return "operating_expense";
}

function normalizeFinanceEntryStatus(rec: FinanceRecord): string {
  const explicitStatus = rec.status?.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const validStatuses = new Set(["recorded", "pending", "paid", "settled", "overdue"]);
  if (explicitStatus && validStatuses.has(explicitStatus)) return explicitStatus;

  const entryType = normalizeFinanceEntryType(rec);
  if (entryType === "receivable" || entryType === "debt") return "pending";
  if (entryType === "payment" || entryType === "salary" || entryType === "cogs" || entryType === "operating_expense") return "paid";
  return "recorded";
}

type StructuredSubmissionKind = 'finance_transactions' | 'project_service_tracking' | 'business_report';

function isStructuredSubmission(reportType: string): reportType is StructuredSubmissionKind {
  return reportType === 'finance_transactions' || reportType === 'project_service_tracking' || reportType === 'business_report';
}

function serializeForPending(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function dateFromPending(value: unknown): Date | null {
  if (!value) return null;
  const timestamp = Date.parse(String(value));
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function structuredSubmissionTitle(kind: StructuredSubmissionKind) {
  if (kind === 'finance_transactions') return 'Finance Transactions';
  if (kind === 'project_service_tracking') return 'Project & Service Tracking';
  return 'Business KPI Report';
}

function approvalReportTypeTitle(reportType: string) {
  if (isStructuredSubmission(reportType)) return structuredSubmissionTitle(reportType);
  if (reportType === 'customer_service') return 'Customer Service';
  return 'Sales & Marketing';
}

function structuredSubmissionCount(pending: { summary: Prisma.JsonValue }) {
  if (pending.summary && typeof pending.summary === 'object' && !Array.isArray(pending.summary)) {
    const total = (pending.summary as Record<string, unknown>).total;
    if (typeof total === 'number' && Number.isFinite(total)) return total;
  }
  return 0;
}

function sourceTelegramMessageId(pending: { summary: Prisma.JsonValue }) {
  if (pending.summary && typeof pending.summary === 'object' && !Array.isArray(pending.summary)) {
    const value = (pending.summary as Record<string, unknown>).sourceTelegramMessageId;
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return null;
}

function sourceTelegramFileId(pending: { summary: Prisma.JsonValue }) {
  if (pending.summary && typeof pending.summary === 'object' && !Array.isArray(pending.summary)) {
    const value = (pending.summary as Record<string, unknown>).sourceTelegramFileId;
    if (typeof value === 'string' && value) return value;
  }
  return null;
}

async function getIndependentDataApprovers(senderId: string, fallbackOwnerUserId: string | null) {
  const submitter = await prisma.telegramSender.findUnique({
    where: { id: senderId },
    select: { userId: true },
  });
  const ownerUserId = submitter?.userId ?? fallbackOwnerUserId;

  // A bot can serve more than one business owner. Approval must follow the
  // submitting staff member's tenant, not whichever owner configured the bot.
  return prisma.telegramSender.findMany({
    where: {
      userId: ownerUserId,
      isAuthorized: true,
      isVerified: true,
      isDataApprover: true,
      id: { not: senderId },
      telegramUserId: { not: null },
    },
    select: { telegramUserId: true },
  });
}

/**
 * After one approver acts on a submission, notify all *other* approvers in the
 * same workspace so they know the item is no longer pending. We send a new
 * message rather than trying to edit theirs (we don't track their message IDs).
 */
async function notifyOtherApprovers({
  actingApproverId,
  pending,
  actionText,
  botToken,
  ownerUserId,
}: {
  actingApproverId: string;
  pending: { id: string; senderId: string; fileName: string; reportType: string };
  actionText: string;
  botToken: string | null | undefined;
  ownerUserId: string | null;
}) {
  // Find all other approvers in the same workspace (excluding the submitter and the acting approver)
  const submitter = await prisma.telegramSender.findUnique({
    where: { id: pending.senderId },
    select: { userId: true },
  });
  const resolvedOwnerUserId = submitter?.userId ?? ownerUserId;
  if (!resolvedOwnerUserId) return;

  const otherApprovers = await prisma.telegramSender.findMany({
    where: {
      userId: resolvedOwnerUserId,
      isAuthorized: true,
      isVerified: true,
      isDataApprover: true,
      id: { notIn: [pending.senderId, actingApproverId] },
      telegramUserId: { not: null },
    },
    select: { telegramUserId: true },
  });

  const itemLabel = isTextSubmission(pending) ? 'Record' : 'File';
  const text = [
    `ℹ️ <b>${itemLabel} submission already handled</b>`,
    '━━━━━━━━━━━━━━━━━━━━',
    `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
    '',
    actionText,
    '',
    'No further action is needed for this submission.',
  ].join('\n');

  await Promise.all(
    otherApprovers.map((approver) =>
      sendTelegramMessage({ botToken, chatId: approver.telegramUserId!, text })
    )
  );
}

async function deliverApprovalFile({
  pending,
  approverChatId,
  botToken,
}: {
  pending: { chatId: bigint; fileName: string; summary: Prisma.JsonValue };
  approverChatId: bigint;
  botToken: string | null | undefined;
}) {
  const originalMessageId = sourceTelegramMessageId(pending);
  const copied = originalMessageId
    ? await copyTelegramMessage({ botToken, fromChatId: pending.chatId, toChatId: approverChatId, messageId: originalMessageId })
    : false;

  // copyMessage can be blocked by Telegram chat protection. For uploaded
  // documents, the bot's file ID provides a dependable fallback.
  if (!copied) {
    const fileId = sourceTelegramFileId(pending);
    if (fileId) {
      await sendTelegramDocument({ botToken, chatId: approverChatId, fileId, fileName: pending.fileName });
    }
  }
}

function isTextSubmission(pending: { fileName: string; fileType?: string | null } | string) {
  const name = typeof pending === 'string' ? pending : pending.fileName;
  return name.toLowerCase().includes('text entry');
}

function isPendingImportBelongsToApprover(
  pendingSenderUserId: string | null | undefined,
  approverUserId: string | null | undefined,
  fallbackOwnerUserId: string | null | undefined
) {
  const ownerUserId = approverUserId || fallbackOwnerUserId;
  if (!ownerUserId) return true;
  return pendingSenderUserId === ownerUserId || pendingSenderUserId === null || pendingSenderUserId === undefined;
}

function buildStructuredPreviewText({ fileName, kind, rowCount, fileType }: { fileName: string; kind: StructuredSubmissionKind; rowCount: number; fileType?: string | null }) {
  const isText = isTextSubmission({ fileName, fileType });
  const itemLabel = isText ? 'Record' : 'File';
  return [
    `📄 <b>${structuredSubmissionTitle(kind)} ${itemLabel.toLowerCase()} preview</b>`,
    '━━━━━━━━━━━━━━━━━━━━',
    `📎 <b>${itemLabel}:</b> <code>${escapeHtml(fileName)}</code>`,
    `📊 <b>Records detected:</b> <code>${rowCount}</code>`,
    '',
    'ဒီ preview မှန်တယ်ဆိုရင် <b>Confirm Import</b> ကိုနှိပ်ပါ။ Confirm ပြီးလျှင် Data Approver ရှိပါက approval စောင့်ပါမည်။',
  ].join('\n');
}

async function queueStructuredSubmission({
  fileName,
  fileType,
  kind,
  payload,
  rowCount,
  senderId,
  messageId,
  sourceTelegramMessageId,
  sourceTelegramFileId,
  chatId,
  progressMsgId,
  botToken,
}: {
  fileName: string;
  fileType: string | null;
  kind: StructuredSubmissionKind;
  payload: unknown;
  rowCount: number;
  senderId: string;
  messageId: string;
  sourceTelegramMessageId?: string | null;
  sourceTelegramFileId?: string | null;
  chatId: bigint;
  progressMsgId: number | null;
  botToken: string | null;
}) {
  const pending = await prisma.pendingDemandImport.create({
    data: {
      senderId,
      messageId,
      chatId,
      previewMessageId: progressMsgId,
      fileName,
      fileType,
      extractedText: '',
      parsedRows: serializeForPending(payload),
      summary: serializeForPending({
        total: rowCount,
        ...(sourceTelegramMessageId ? { sourceTelegramMessageId } : {}),
        ...(sourceTelegramFileId ? { sourceTelegramFileId } : {}),
      }),
      reportType: kind,
      status: 'pending',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
  const replyMarkup = {
    inline_keyboard: [[
      { text: '✅ Confirm Import', callback_data: `demand_import_confirm:${pending.id}` },
      { text: '❌ Cancel', callback_data: `demand_import_cancel:${pending.id}` },
    ]],
  };
  const text = buildStructuredPreviewText({ fileName, kind, rowCount, fileType });
  if (progressMsgId) {
    await editTelegramMessage({ botToken, chatId, messageId: progressMsgId, text, replyMarkup });
  } else {
    const preview = await sendTelegramMessage({ botToken, chatId, text, replyMarkup });
    if (preview) {
      await prisma.pendingDemandImport.update({ where: { id: pending.id }, data: { previewMessageId: preview.message_id } });
    }
  }
}

async function importStructuredSubmission(pending: { reportType: string; parsedRows: Prisma.JsonValue; senderId: string; messageId: string; fileName: string; fileType: string | null }, ownerUserId: string | null, fallbackDate: Date) {
  const payload = pending.parsedRows as Record<string, unknown>;
  if (pending.reportType === 'finance_transactions') {
    const records = Array.isArray(payload.records) ? payload.records : [];
    const financeRecords: FinanceRecord[] = records.map((row) => {
      const value = row as Record<string, unknown>;
      return {
        date: dateFromPending(value.date) || fallbackDate,
        description: String(value.description || ''), category: String(value.category || ''), type: String(value.type || ''),
        amount: Number(value.amount || 0), paymentMethod: String(value.paymentMethod || ''), reference: String(value.reference || ''), notes: String(value.notes || ''),
        financeRecordType: typeof value.financeRecordType === 'string' ? value.financeRecordType : undefined,
        status: typeof value.status === 'string' ? value.status : undefined,
        counterparty: typeof value.counterparty === 'string' ? value.counterparty : undefined,
        dueDate: dateFromPending(value.dueDate), voucherNumber: typeof value.voucherNumber === 'string' ? value.voucherNumber : undefined,
        accountingSection: typeof value.accountingSection === 'string' ? value.accountingSection : undefined,
      };
    });
    const businessCreates = financeRecords.filter((rec) => normalizeFinanceEntryType(rec) !== 'owner_capital').map((rec) => {
      const isIncome = rec.type.toLowerCase() === 'income'; const recordDate = rec.date || fallbackDate;
      return { uploadedByUserId: ownerUserId, reportDate: recordDate, senderId: pending.senderId, messageId: pending.messageId, marketingBudget: isIncome ? 0 : rec.amount, marketingChannel: rec.category || 'Service', notes: `${rec.description} (Ref: ${rec.reference}, Method: ${rec.paymentMethod}). ${rec.notes || ''}`, totalSalesAmount: isIncome ? rec.amount : 0, newLeads: isIncome ? 0 : (rec.category === 'Marketing' ? 1 : 0), closedDeals: isIncome ? 1 : 0, totalDemandCount: null, reporterName: 'Telegram Upload', createdAt: recordDate };
    });
    const accountingCreates = financeRecords.map((rec) => {
      const noteParts = [rec.notes, rec.paymentMethod ? `Method: ${rec.paymentMethod}` : '', rec.reference ? `Reference: ${rec.reference}` : '', rec.accountingSection ? `Section: ${rec.accountingSection}` : ''].filter(Boolean);
      return { uploadedByUserId: ownerUserId, entryDate: rec.date || fallbackDate, type: normalizeFinanceEntryType(rec), title: rec.description || rec.category || 'Finance record', amount: rec.amount, status: normalizeFinanceEntryStatus(rec), counterparty: rec.counterparty?.trim() || null, dueDate: rec.dueDate || null, voucherNumber: rec.voucherNumber?.trim() || rec.reference?.trim() || null, notes: noteParts.join('. ') || null, createdAt: rec.date || fallbackDate };
    });
    await prisma.$transaction([
      ...(businessCreates.length ? [prisma.businessReport.createMany({ data: businessCreates })] : []),
      ...(accountingCreates.length ? [prisma.financeEntry.createMany({ data: accountingCreates })] : []),
    ]);
    return financeRecords.length;
  }

  if (pending.reportType === 'project_service_tracking') {
    const projectRows = Array.isArray(payload.projects) ? payload.projects : [];
    const websiteRows = Array.isArray(payload.websites) ? payload.websites : [];
    const projectCreates = projectRows.map((row) => {
      const value = row as Record<string, unknown>;
      return { uploadedByUserId: ownerUserId, projectName: String(value.projectName || ''), url: typeof value.url === 'string' ? value.url : null, packageName: typeof value.packageName === 'string' ? value.packageName : null, domainProvider: typeof value.domainProvider === 'string' ? value.domainProvider : null, hostingProvider: typeof value.hostingProvider === 'string' ? value.hostingProvider : null, hostingRemark: typeof value.hostingRemark === 'string' ? value.hostingRemark : null, domainExpireDate: dateFromPending(value.domainExpireDate), hostingExpireDate: dateFromPending(value.hostingExpireDate), offerExpireDate: dateFromPending(value.offerExpireDate), projectStatus: typeof value.projectStatus === 'string' ? value.projectStatus : 'active', remark: typeof value.remark === 'string' ? value.remark : null, createdAt: dateFromPending(value.createdAt) || fallbackDate };
    });
    const websiteCreates = websiteRows.map((row) => {
      const value = row as Record<string, unknown>;
      return { uploadedByUserId: ownerUserId, name: String(value.name || ''), url: typeof value.url === 'string' ? value.url : null, businessType: typeof value.businessType === 'string' ? value.businessType : null, packageName: typeof value.packageName === 'string' ? value.packageName : null, status: typeof value.status === 'string' ? value.status : 'pending_update', remark: typeof value.remark === 'string' ? value.remark : null, createdAt: dateFromPending(value.createdAt) || fallbackDate };
    });
    await prisma.$transaction([
      ...(projectCreates.length ? [prisma.projectExpiration.createMany({ data: projectCreates })] : []),
      ...(websiteCreates.length ? [prisma.websiteUpdate.createMany({ data: websiteCreates })] : []),
    ]);
    return Math.max(projectCreates.length, websiteCreates.length);
  }

  if (pending.reportType === 'business_report') {
    const records = Array.isArray(payload.records) ? payload.records : [];
    const creates = records.map((row) => {
      const value = row as Record<string, unknown>;
      const numberOrNull = (input: unknown) => typeof input === 'number' && Number.isFinite(input) ? input : null;
      return { uploadedByUserId: ownerUserId, reportDate: dateFromPending(value.reportDate) || fallbackDate, reporterName: typeof value.reporterName === 'string' ? value.reporterName : null, senderId: pending.senderId, messageId: pending.messageId, marketingBudget: numberOrNull(value.marketingBudget), marketingChannel: typeof value.marketingChannel === 'string' ? value.marketingChannel : null, callsMade: numberOrNull(value.callsMade), appointmentsMade: numberOrNull(value.appointmentsMade), appointmentsKept: numberOrNull(value.appointmentsKept), newLeads: numberOrNull(value.newLeads), totalDemandCount: numberOrNull(value.totalDemandCount), totalSalesAmount: numberOrNull(value.totalSalesAmount), closedDeals: numberOrNull(value.closedDeals), pendingDeals: numberOrNull(value.pendingDeals), notes: typeof value.notes === 'string' ? value.notes : null, targetDemandCount: numberOrNull(value.targetDemandCount), targetAppointments: numberOrNull(value.targetAppointments), targetSalesAmount: numberOrNull(value.targetSalesAmount) };
    });
    if (creates.length) await prisma.businessReport.createMany({ data: creates });
    return creates.length;
  }
  return 0;
}

function getCopyPasteTemplateForMode(mode: string | null | undefined): string {
  switch (mode) {
    case 'demand_report':
      return [
        "📈 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Sales & Marketing Template</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စာသားကို ဖိနှိပ်၍ Copy ကူးယူပါ -",
        "",
        "<code>• Date: \n• Customer Name: \n• Phone: \n• Company: \n• Service Name: \n• Service Amount: \n• Service Qty: \n• Follow-up Date: \n• Note: </code>",
      ].join("\n");
    case 'customer_service':
      return [
        "🎧 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Customer Service Template</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စာသားကို ဖိနှိပ်၍ Copy ကူးယူပါ -",
        "",
        "<code>• Date: \n• Customer Name: \n• Company: \n• Phone: \n• Email: \n• Purchased Service: \n• Purchase Amount MMK: \n• Status: \n• Next Follow Up: \n• CSAT: \n• Last Contact Note: </code>",
      ].join("\n");
    case 'project_expiry':
      return [
        "⏰ ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Project Expiry Template</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စာသားကို ဖိနှိပ်၍ Copy ကူးယူပါ -",
        "",
        "<code>• Date: \n• Check List: \n• URL: \n• Package: \n• Domain Provider: \n• Hosting Provider: \n• Hosting Remark: \n• Domain Expiration Date: \n• Hosting Expiration Date: \n• Remark: </code>",
      ].join("\n");
    case 'website_update':
      return [
        "🔧 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Website Update Template</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စာသားကို ဖိနှိပ်၍ Copy ကူးယူပါ -",
        "",
        "<code>• Date: \n• Project Name: \n• Website Link: \n• Business Type: \n• Package Name: \n• Status: \n• Remark: </code>",
      ].join("\n");
    case 'project_service_tracking':
      return [
        "🧩 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Project &amp; Service Tracking Template</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စာသားကို ဖိနှိပ်၍ Copy ကူးယူပါ -",
        "",
        "<code>• Record Date: \n• Project Name: \n• Website Link: \n• Business Type: \n• Package Name: \n• Domain Provider: \n• Hosting Provider: \n• Hosting Remark: \n• Domain Expiration Date: \n• Hosting Expiration Date: \n• Offer Expiry / Renewal Date: \n• Project Status: \n• Expiry / Service Remark: \n• Update Status: \n• Update Remark: </code>",
      ].join("\n");
    case 'finance_transactions':
      return [
        "💳 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Finance Transactions Template</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စာသားကို ဖိနှိပ်၍ Copy ကူးယူပါ -",
        "",
        "<code>Date: \nDescription: \nCategory: \nType: Income or Expense\nAmount (MMK): \nPayment Method: \nReference: \nNotes: \nFinance Record Type: \nStatus: \nCounterparty: \nDue Date: \nVoucher Number: \nAccounting Section: </code>",
      ].join("\n");
    case 'business_report':
      return [
        "📊 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>Business KPI Report Template</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "စာသားကို ဖိနှိပ်၍ Copy ကူးယူပါ -",
        "",
        "<code>• Date: \n• Reporter: \n• Marketing Budget: \n• Marketing Channel: \n• Calls Made: \n• Appointments Made: \n• Appointments Kept: \n• New Leads: \n• Total Sales Amount: \n• Closed Deals: \n• Pending Deals: \n• Notes: </code>",
      ].join("\n");
    default:
      return [
        "🤖 ━━━━━━━━━━━━━━━━━━━━",
        "",
        "  <b>အဆင်သင့်မဖြစ်သေးပါ</b>",
        "",
        "━━━━━━━━━━━━━━━━━━━━",
        "",
        "Template ရယူရန် ဦးစွာ /menu မှ",
        "ကဏ္ဍတစ်ခုကို ရွေးချယ်ပေးပါ။",
      ].join("\n");
  }
}

function getMyanmarFieldName(field: string): string {
  switch (field) {
    case 'customerName':
      return 'Customer Name (ဝယ်ယူသူအမည်)';
    case 'phone':
      return 'Phone Number (ဖုန်းနံပါတ်)';
    case 'service':
      return 'Service (ဝန်ဆောင်မှုအမည်)';
    case 'followUpDate':
      return 'Follow-up Date (နောက်ဆက်တွဲဆက်သွယ်ရမည့်ရက်)';
    default:
      return field;
  }
}


async function buildQAContext(ownerUserId: string | null): Promise<string> {
  const [demandRecords, qaDocs, customers, projectExpiries, websiteUpdates, businessReports] = await Promise.all([
    prisma.demandRecord.findMany({
      where: { ...(ownerUserId ? { sender: { userId: ownerUserId } } : {}), ...notDeleted },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { sender: true },
    }),
    prisma.qADocument.findMany({
      where: ownerUserId ? { userId: ownerUserId } : {},
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.customer.findMany({
      where: { ...(ownerUserId ? { userId: ownerUserId } : {}), ...notDeleted },
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.projectExpiration.findMany({
      where: { ...(ownerUserId ? { uploadedByUserId: ownerUserId } : {}), ...notDeleted },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.websiteUpdate.findMany({
      where: { ...(ownerUserId ? { uploadedByUserId: ownerUserId } : {}), ...notDeleted },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.businessReport.findMany({
      where: { ...(ownerUserId ? { sender: { userId: ownerUserId } } : {}), ...notDeleted },
      orderBy: { reportDate: 'desc' },
      take: 15,
      include: { sender: true },
    }),
  ]);

  const parts: string[] = [];

  if (demandRecords.length > 0) {
    parts.push('=== RECENT DEMAND SHEETS ===');
    for (const r of demandRecords) {
      const fields = [
        `Date: ${r.createdAt.toISOString().slice(0, 10)}`,
        `Reporter: ${r.sender?.displayName || "System / Uploaded"}`,
        r.customerName ? `Customer: ${r.customerName}` : 'Customer: —',
        r.serviceName ? `Service: ${r.serviceName} (Amount: ${r.serviceAmount ?? '—'}, Qty: ${r.serviceQty ?? '—'})` : 'Service: —',
        r.followUpDate ? `Follow-up Date: ${r.followUpDate.toISOString().slice(0, 10)}` : 'Follow-up: —',
        `Note: ${r.note || '—'}`,
      ].join(', ');
      parts.push(fields);
    }
  }

  if (businessReports.length > 0) {
    parts.push('\n=== BUSINESS ACTIVITY REPORTS ===');
    for (const br of businessReports) {
      const fields = [
        `Date: ${br.reportDate.toISOString().slice(0, 10)}`,
        br.reporterName ? `Reporter: ${br.reporterName}` : br.sender ? `Reporter: ${br.sender.displayName}` : '',
        br.marketingChannel ? `Channel: ${br.marketingChannel}` : '',
        br.marketingBudget != null ? `Budget: ${br.marketingBudget.toLocaleString()} Ks` : '',
        br.callsMade != null ? `Calls: ${br.callsMade}` : '',
        br.appointmentsMade != null ? `Appts Made: ${br.appointmentsMade}` : '',
        br.appointmentsKept != null ? `Appts Kept: ${br.appointmentsKept}` : '',
        br.newLeads != null ? `New Leads: ${br.newLeads}` : '',
        br.totalSalesAmount != null ? `Sales: ${br.totalSalesAmount.toLocaleString()} Ks` : '',
        br.closedDeals != null ? `Closed: ${br.closedDeals}` : '',
        br.pendingDeals != null ? `Pending: ${br.pendingDeals}` : '',
        br.notes ? `Notes: ${br.notes}` : '',
      ].filter(Boolean).join(', ');
      parts.push(fields);
    }
  }

  if (projectExpiries.length > 0) {
    parts.push('\n=== PROJECT EXPIRATIONS (DOMAINS & HOSTING) ===');
    for (const pe of projectExpiries) {
      const fields = [
        `Project: ${pe.projectName}`,
        pe.url ? `URL: ${pe.url}` : 'URL: —',
        pe.packageName ? `Package: ${pe.packageName}` : 'Package: —',
        pe.domainProvider ? `Domain Provider: ${pe.domainProvider}` : 'Domain Provider: —',
        pe.domainExpireDate ? `Domain Expiry: ${pe.domainExpireDate.toISOString().slice(0, 10)}` : 'Domain Expiry: —',
        pe.hostingProvider ? `Hosting Provider: ${pe.hostingProvider}` : 'Hosting Provider: —',
        pe.hostingExpireDate ? `Hosting Expiry: ${pe.hostingExpireDate.toISOString().slice(0, 10)}` : 'Hosting Expiry: —',
        pe.remark ? `Remark: ${pe.remark}` : '',
      ].filter(Boolean).join(', ');
      parts.push(fields);
    }
  }

  if (websiteUpdates.length > 0) {
    parts.push('\n=== WEBSITE MAINTENANCE & UPDATES ===');
    for (const wu of websiteUpdates) {
      const fields = [
        `Name: ${wu.name}`,
        wu.url ? `URL: ${wu.url}` : 'URL: —',
        wu.businessType ? `Business: ${wu.businessType}` : 'Business: —',
        wu.packageName ? `Package: ${wu.packageName}` : 'Package: —',
        `Status: ${wu.status}`,
        wu.remark ? `Remark: ${wu.remark}` : '',
      ].filter(Boolean).join(', ');
      parts.push(fields);
    }
  }

  if (qaDocs.length > 0) {
    parts.push('\n=== REFERENCE DOCUMENTS ===');
    for (const doc of qaDocs) {
      parts.push(`[${doc.title}]: ${doc.content.slice(0, 500)}`);
    }
  }

  if (customers.length > 0) {
    parts.push('\n=== CUSTOMERS ===');
    parts.push(customers.map(c => `${c.name} (${c.status})`).join(', '));
  }

  return parts.join('\n') || 'No business data available yet.';
}

async function resolveCustomersBatch(
  parsedDemands: {
    customerName: string | null;
    customerPhone?: string | null;
    customerCompany?: string | null;
    createdAt?: Date | null;
  }[],
  senderId: string,
  fileName: string,
  ownerUserId: string | null,
): Promise<Map<string, string>> {
  const nameToNormalized = new Map<string, string>();
  const nameToDetails = new Map<string, { phone: string | null; company: string | null; createdAt: Date | null }>();

  for (const d of parsedDemands) {
    if (d.customerName) {
      const normalized = normalizeCustomerName(d.customerName);
      if (!nameToNormalized.has(d.customerName)) {
        nameToNormalized.set(d.customerName, normalized);
      }

      const existing = nameToDetails.get(d.customerName);
      const existingDate = existing?.createdAt ?? null;
      const newDate = d.createdAt ?? null;
      let earliestDate = existingDate;
      if (newDate) {
        if (!earliestDate || newDate < earliestDate) {
          earliestDate = newDate;
        }
      }

      nameToDetails.set(d.customerName, {
        phone: d.customerPhone ? formatPhoneNumber(d.customerPhone) : (existing ? existing.phone : null),
        company: d.customerCompany || (existing ? existing.company : null),
        createdAt: earliestDate,
      });
    }
  }
  if (nameToNormalized.size === 0) return new Map();

  const allNormalized = Array.from(new Set(nameToNormalized.values()));
  const allRawNames = Array.from(nameToNormalized.keys());

  const [byNormalizedRows, byRawNameRows] = await Promise.all([
    prisma.customer.findMany({
      where: { nameNormalized: { in: allNormalized }, userId: ownerUserId },
      select: { id: true, name: true, nameNormalized: true, deletedAt: true },
    }),
    prisma.customer.findMany({
      where: { name: { in: allRawNames }, userId: ownerUserId },
      select: { id: true, name: true, nameNormalized: true, deletedAt: true },
    }),
  ]);

  const idByNormalized = new Map<string, { id: string; name: string; nameNormalized: string | null; deletedAt?: Date | null }>();
  for (const c of byNormalizedRows) {
    if (c.nameNormalized) idByNormalized.set(c.nameNormalized, c);
  }
  for (const c of byRawNameRows) {
    if (c.nameNormalized) {
      if (!idByNormalized.has(c.nameNormalized)) idByNormalized.set(c.nameNormalized, c);
    } else {
      const targetNormalized = nameToNormalized.get(c.name);
      if (targetNormalized && !idByNormalized.has(targetNormalized)) {
        idByNormalized.set(targetNormalized, c);
      }
    }
  }

  const missingNames: { raw: string; normalized: string }[] = [];
  for (const [raw, normalized] of nameToNormalized.entries()) {
    if (!idByNormalized.has(normalized)) missingNames.push({ raw, normalized });
  }

  for (const m of missingNames) {
    try {
      const details = nameToDetails.get(m.raw);
      const created = await prisma.customer.create({
        data: {
          name: m.raw,
          userId: ownerUserId,
          nameNormalized: m.normalized,
          phone: details?.phone || null,
          company: details?.company || null,
          createdAt: details?.createdAt ?? undefined,
        },
        select: { id: true, name: true, nameNormalized: true, deletedAt: true },
      });
      idByNormalized.set(m.normalized, created);
    } catch (err) {
      if (isPrismaUniqueConstraintError(err)) {
        const existing = await prisma.customer.findFirst({
          where: { nameNormalized: m.normalized, userId: ownerUserId },
          select: { id: true, name: true, nameNormalized: true, deletedAt: true },
        });
        if (existing) idByNormalized.set(m.normalized, existing);
      } else {
        throw err;
      }
    }
  }

  // Update details (phone, company) and backfill normalized name for existing/newly resolved customers
  await Promise.all(
    Array.from(idByNormalized.values()).map(async (c) => {
      const details = nameToDetails.get(c.name);
      if (!details) return;
      const updateData: {
        phone?: string;
        company?: string;
        nameNormalized?: string;
        updatedAt?: Date;
        status?: string;
        deletedAt?: null;
        deletedByUserId?: null;
        deletedReason?: null;
        restoredAt?: Date;
        restoredByUserId?: string | null;
      } = {};
      if (details.phone) {
        updateData.phone = details.phone;
      }
      if (details.company) {
        updateData.company = details.company;
      }
      const targetNormalized = nameToNormalized.get(c.name);
      if (targetNormalized && !c.nameNormalized) {
        updateData.nameNormalized = targetNormalized;
      }
      if (c.deletedAt && ownerUserId) {
        Object.assign(updateData, restoreData(ownerUserId), { status: "active" });
      }

      if (Object.keys(updateData).length > 0) {
        updateData.updatedAt = new Date();
        await prisma.customer.update({
          where: { id: c.id },
          data: updateData,
        });
      }
    })
  );

  const rawNameToId = new Map<string, string>();
  for (const [raw, normalized] of nameToNormalized.entries()) {
    const entry = idByNormalized.get(normalized);
    if (entry) rawNameToId.set(raw, entry.id);
  }

  const activityCreates = Array.from(rawNameToId.entries()).map(([raw, id]) => {
    const details = nameToDetails.get(raw);
    return {
      customerId: id,
      senderId,
      action: 'demand_report',
      description: `File: ${fileName}`,
      createdAt: details?.createdAt ?? undefined,
    };
  });
  if (activityCreates.length > 0) {
    await prisma.customerActivity.createMany({ data: activityCreates });
  }

  return rawNameToId;
}

function escapeHtml(value: string | null | undefined): string {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function serializeParsedDemand(record: ParsedDemandRecord) {
  return {
    ...record,
    followUpDate: record.followUpDate ? record.followUpDate.toISOString() : null,
    createdAt: record.createdAt ? record.createdAt.toISOString() : null,
  };
}

function hydrateParsedDemand(record: Record<string, unknown>): ParsedDemandRecord {
  const parseDate = (value: unknown) => {
    if (!value) return null;
    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : new Date(parsed);
  };

  return {
    customerName: typeof record.customerName === 'string' ? record.customerName : null,
    customerPhone: typeof record.customerPhone === 'string' ? record.customerPhone : null,
    customerCompany: typeof record.customerCompany === 'string' ? record.customerCompany : null,
    category: typeof record.category === 'string' ? record.category : 'demand',
    status: typeof record.status === 'string' ? record.status : 'new',
    note: typeof record.note === 'string' ? record.note : '',
    confidence: typeof record.confidence === 'number' ? record.confidence : 0.35,
    aiProvider: typeof record.aiProvider === 'string' ? record.aiProvider : 'heuristic',
    aiModel: typeof record.aiModel === 'string' ? record.aiModel : null,
    followUpDate: parseDate(record.followUpDate),
    serviceName: typeof record.serviceName === 'string' ? record.serviceName : null,
    serviceAmount: typeof record.serviceAmount === 'number' ? record.serviceAmount : null,
    serviceQty: typeof record.serviceQty === 'number' ? record.serviceQty : null,
    createdAt: parseDate(record.createdAt),
  };
}

function summarizeParsedDemands(parsedDemands: ParsedDemandRecord[]) {
  const summary = {
    total: parsedDemands.length,
    high: 0,
    medium: 0,
    low: 0,
    missingPhone: 0,
    missingCustomer: 0,
    missingService: 0,
    dueOrOverdue: 0,
  };

  parsedDemands.forEach((record) => {
    const analysis = analyzeDemandRecord(record);
    summary[analysis.priority] += 1;
    if (analysis.missingFields.includes('phone')) summary.missingPhone += 1;
    if (analysis.missingFields.includes('customerName')) summary.missingCustomer += 1;
    if (analysis.missingFields.includes('service')) summary.missingService += 1;
    if (analysis.followUpStatus === 'due' || analysis.followUpStatus === 'overdue') {
      summary.dueOrOverdue += 1;
    }
  });

  return summary;
}

function buildDemandImportPreviewText({
  fileName,
  parsedDemands,
  errors,
  activeMode,
  fileType,
}: {
  fileName: string;
  parsedDemands: ParsedDemandRecord[];
  errors: string[];
  activeMode?: string;
  fileType?: string | null;
}) {
  const isText = isTextSubmission({ fileName, fileType });
  const itemLabel = isText ? 'Record' : 'File';
  const summary = summarizeParsedDemands(parsedDemands);
  const title = activeMode === 'customer_service'
    ? `🎧 <b>Customer Service ${itemLabel.toLowerCase()} preview</b>`
    : `📄 <b>Sales & Marketing ${itemLabel.toLowerCase()} preview</b>`;
  const parts = [
    title,
    "━━━━━━━━━━━━━━━━━━━━",
    `📎 <b>${itemLabel}:</b> <code>${escapeHtml(fileName)}</code>`,
    `📊 <b>Rows detected:</b> <code>${summary.total}</code>`,
    "",
    "🎯 <b>Priority summary</b>",
    `• High: <b>${summary.high}</b>`,
    `• Medium: <b>${summary.medium}</b>`,
    `• Low: <b>${summary.low}</b>`,
    "",
    "⚠️ <b>Data quality</b>",
    `• Missing phone: <b>${summary.missingPhone}</b>`,
    `• Missing customer: <b>${summary.missingCustomer}</b>`,
    `• Missing service: <b>${summary.missingService}</b>`,
    `• Due/overdue follow-up: <b>${summary.dueOrOverdue}</b>`,
  ];

  if (errors.length > 0) {
    parts.push("", "⚠️ <b>Parsing warnings</b>");
    errors.slice(0, 4).forEach((error) => {
      parts.push(`• <code>${escapeHtml(error)}</code>`);
    });
    if (errors.length > 4) parts.push(`• ...and ${errors.length - 4} more warning(s)`);
  }

  if (parsedDemands.length > 0) {
    parts.push("", "📋 <b>Sample rows (first 5)</b>", "━━━━━━━━━━━━━━━━━━━━");
    parsedDemands.slice(0, 5).forEach((record, idx) => {
      const analysis = analyzeDemandRecord(record);
      parts.push(
        [
          `<b>#${idx + 1} ${escapeHtml(record.customerName || 'Unknown customer')}</b>`,
          `  • Priority: <b>${analysis.priority.toUpperCase()}</b> (${analysis.potentialScore}/100)`,
          `  • Service: ${escapeHtml(record.serviceName || 'Unknown')}`,
          `  • Action: ${escapeHtml(analysis.recommendedAction)}`,
        ].join("\n"),
      );
    });
  }

  parts.push(
    "",
    `ဒီ preview မှန်တယ်ဆိုရင် <b>Confirm Import</b> ကိုနှိပ်ပါ။ မမှန်ရင် <b>Cancel</b> နှိပ်ပြီး ${isText ? 'text data' : 'file/header'} ကိုပြန်စစ်ပါ။`,
  );

  return parts.join("\n");
}

async function createDemandRecordsFromParsedDemands({
  parsedDemands,
  senderId,
  telegramMessageId,
  fileName,
  sourceType = 'telegram',
  reportType = 'demand_report',
  importBatchId,
  ownerUserId,
}: {
  parsedDemands: ParsedDemandRecord[];
  senderId: string;
  telegramMessageId: string;
  fileName?: string | null;
  sourceType?: string;
  reportType?: string;
  importBatchId?: string | null;
  ownerUserId: string | null;
}) {
  const customerIdByName = await resolveCustomersBatch(
    parsedDemands,
    senderId,
    fileName || 'Telegram demand import',
    ownerUserId,
  );

  const demandRecordCreates: Prisma.DemandRecordUncheckedCreateInput[] = [];
  for (const parsedDemand of parsedDemands) {
    const analysis = analyzeDemandRecord(parsedDemand);
    const customerId = parsedDemand.customerName
      ? customerIdByName.get(parsedDemand.customerName) ?? null
      : null;

    demandRecordCreates.push({
      messageId: telegramMessageId,
      senderId,
      customerId,
      customerName: parsedDemand.customerName,
      category: parsedDemand.category,
      reportType,
      status: parsedDemand.status,
      note: parsedDemand.note,
      sourceType,
      sourceChannel: parsedDemand.sourceChannel || null,
      sourceFileName: fileName || null,
      normalizedData: serializeParsedDemand(parsedDemand),
      importBatchId: importBatchId || null,
      serviceName: parsedDemand.serviceName,
      serviceAmount: parsedDemand.serviceAmount,
      serviceQty: parsedDemand.serviceQty,
      followUpDate: parsedDemand.followUpDate,
      followUpStatus: analysis.followUpStatus,
      priority: analysis.priority,
      potentialScore: analysis.potentialScore,
      priorityReason: analysis.priorityReason,
      recommendedAction: analysis.recommendedAction,
      missingFields: analysis.missingFields,
      confidence: parsedDemand.confidence,
      aiProvider: parsedDemand.aiProvider,
      aiModel: parsedDemand.aiModel,
      createdAt: parsedDemand.createdAt || undefined,
    });
  }

  if (demandRecordCreates.length > 0) {
    await prisma.demandRecord.createMany({ data: demandRecordCreates });
  }

  return demandRecordCreates.length;
}

async function processFileInBackground({
  downloadedBuffer,
  fileInfo,
  caption,
  settings,
  chatId,
  senderId,
  telegramMessageId,
  sourceTelegramMessageId,
  sourceTelegramFileId,
  progressMsgId,
  receivedAtMyanmar,
  activeMode,
}: {
  downloadedBuffer: Buffer;
  fileInfo: { fileId: string; fileName: string; mimeType: string; fileSize: number };
  caption?: string;
  settings: { userId: string | null; botToken: string | null; geminiApiKey: string | null; geminiModel: string | null };
  chatId: bigint;
  senderId: string;
  telegramMessageId: string;
  sourceTelegramMessageId: string;
  sourceTelegramFileId: string;
  progressMsgId: number | null;
  receivedAtMyanmar: Date;
  activeMode: string;
}) {
  const errors: string[] = [];
  try {
    const isSpreadsheet = fileInfo.mimeType.includes("sheet") ||
      fileInfo.mimeType.includes("excel") ||
      fileInfo.mimeType.includes("csv") ||
      fileInfo.fileName.endsWith(".xlsx") ||
      fileInfo.fileName.endsWith(".xls") ||
      fileInfo.fileName.endsWith(".xlsm") ||
      fileInfo.fileName.endsWith(".csv");

    let isExpiryFile = false;
    let parsedExpiryRecords: ParsedProjectExpiration[] = [];
    let isWebsiteUpdateFile = false;
    let parsedWebsiteUpdateRecords: ParsedWebsiteUpdate[] = [];
    let isProjectServiceTrackingFile = false;
    let isBusinessReportFile = false;
    let parsedBusinessReportRecords: ParsedBusinessReport[] = [];
    let isFinanceFile = false;
    let parsedFinanceRecords: FinanceRecord[] = [];

    if (isSpreadsheet) {
      try {
        const workbook = XLSX.read(downloadedBuffer, { type: 'buffer', cellDates: true });
        if (workbook.SheetNames.length > 0) {
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });
          if (rows.length > 0 && Array.isArray(rows[0])) {
            const headers = rows[0].map(h => String(h || ''));
            if (isProjectServiceTrackingHeaders(headers)) {
              isProjectServiceTrackingFile = true;
              parsedExpiryRecords = parseProjectExpirySpreadsheet(downloadedBuffer);
              parsedWebsiteUpdateRecords = parseWebsiteUpdateSpreadsheet(downloadedBuffer);
            } else if (isProjectExpiryHeaders(headers)) {
              isExpiryFile = true;
              parsedExpiryRecords = parseProjectExpirySpreadsheet(downloadedBuffer);
            } else if (isWebsiteUpdateHeaders(headers)) {
              isWebsiteUpdateFile = true;
              parsedWebsiteUpdateRecords = parseWebsiteUpdateSpreadsheet(downloadedBuffer);
            } else if (isBusinessReportHeaders(headers)) {
              isBusinessReportFile = true;
              parsedBusinessReportRecords = parseBusinessReportSpreadsheet(downloadedBuffer);
            } else if (isFinanceRecordsHeaders(headers)) {
              isFinanceFile = true;
              parsedFinanceRecords = parseFinanceRecordsSpreadsheet(downloadedBuffer);
            }
          }
        }
      } catch (err) {
        console.error("Error checking headers for spreadsheet types:", err);
      }
    }

    if (isProjectServiceTrackingFile) {
      await queueStructuredSubmission({
        fileName: fileInfo.fileName, fileType: fileInfo.mimeType, kind: 'project_service_tracking',
        payload: { projects: parsedExpiryRecords, websites: parsedWebsiteUpdateRecords },
        rowCount: Math.max(parsedExpiryRecords.length, parsedWebsiteUpdateRecords.length),
        senderId, messageId: telegramMessageId, sourceTelegramMessageId, sourceTelegramFileId, chatId, progressMsgId, botToken: settings.botToken,
      });
      return;
    }

    if (isExpiryFile) {
      await queueStructuredSubmission({
        fileName: fileInfo.fileName, fileType: fileInfo.mimeType, kind: 'project_service_tracking',
        payload: { projects: parsedExpiryRecords, websites: [] }, rowCount: parsedExpiryRecords.length,
        senderId, messageId: telegramMessageId, sourceTelegramMessageId, sourceTelegramFileId, chatId, progressMsgId, botToken: settings.botToken,
      });
      return;
    }

    if (isWebsiteUpdateFile) {
      await queueStructuredSubmission({
        fileName: fileInfo.fileName, fileType: fileInfo.mimeType, kind: 'project_service_tracking',
        payload: { projects: [], websites: parsedWebsiteUpdateRecords }, rowCount: parsedWebsiteUpdateRecords.length,
        senderId, messageId: telegramMessageId, sourceTelegramMessageId, sourceTelegramFileId, chatId, progressMsgId, botToken: settings.botToken,
      });
      return;
    }

    if (isBusinessReportFile) {
      await queueStructuredSubmission({
        fileName: fileInfo.fileName, fileType: fileInfo.mimeType, kind: 'business_report',
        payload: { records: parsedBusinessReportRecords }, rowCount: parsedBusinessReportRecords.length,
        senderId, messageId: telegramMessageId, sourceTelegramMessageId, sourceTelegramFileId, chatId, progressMsgId, botToken: settings.botToken,
      });
      return;
    }

    if (isFinanceFile) {
      await queueStructuredSubmission({
        fileName: fileInfo.fileName, fileType: fileInfo.mimeType, kind: 'finance_transactions',
        payload: { records: parsedFinanceRecords }, rowCount: parsedFinanceRecords.length,
        senderId, messageId: telegramMessageId, sourceTelegramMessageId, sourceTelegramFileId, chatId, progressMsgId, botToken: settings.botToken,
      });
      return;
    }

    const { extractedText, parsed: parsedDemands } = await extractDataFromFile({
      fileBuffer: downloadedBuffer,
      mimeType: fileInfo.mimeType,
      fileName: fileInfo.fileName,
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

    const summary = summarizeParsedDemands(parsedDemands);
    const pendingImport = await prisma.pendingDemandImport.create({
      data: {
        senderId,
        messageId: telegramMessageId,
        chatId,
        previewMessageId: progressMsgId,
        fileName: fileInfo.fileName,
        fileType: fileInfo.mimeType,
        extractedText: extractedText.slice(0, 10000),
        parsedRows: parsedDemands.map(serializeParsedDemand),
        summary: { ...summary, sourceTelegramMessageId, sourceTelegramFileId },
        errors,
        reportType: activeMode === 'customer_service' ? 'customer_service' : 'demand_report',
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const previewText = buildDemandImportPreviewText({
      fileName: fileInfo.fileName,
      parsedDemands,
      errors,
      activeMode,
    });
    const replyMarkup = {
      inline_keyboard: [
        [
          { text: "✅ Confirm Import", callback_data: `demand_import_confirm:${pendingImport.id}` },
          { text: "❌ Cancel", callback_data: `demand_import_cancel:${pendingImport.id}` },
        ],
      ],
    };

    if (progressMsgId) {
      await editTelegramMessage({
        botToken: settings.botToken,
        chatId,
        messageId: progressMsgId,
        text: previewText,
        replyMarkup,
      });
    } else {
      const previewMessage = await sendTelegramMessage({
        botToken: settings.botToken,
        chatId,
        text: previewText,
        replyMarkup,
      });
      if (previewMessage) {
        await prisma.pendingDemandImport.update({
          where: { id: pendingImport.id },
          data: { previewMessageId: previewMessage.message_id },
        });
      }
    }
  } catch (err) {
    console.error('Background file processing error:', err);
    const errMessage = err instanceof Error ? err.message : String(err);
    const errorText = [
      "❌ <b>ဖိုင်ဆန်းစစ်ရာတွင် ချို့ယွင်းချက် ဖြစ်ပေါ်ခဲ့ပါသည်</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
      "⚠️ <b>အခြေအနေ:</b> နည်းပညာဆိုင်ရာ ချို့ယွင်းချက် ဖြစ်ပေါ်ခဲ့ပါသည်။ ကျေးဇူးပြု၍ ပြန်လည်ကြိုးစားပေးပါရန်။",
      "",
      "🔍 <b>အသေးစိတ် ချို့ယွင်းချက်:</b>",
      `<code>${errMessage}</code>`,
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

function isBusinessReportText(text: string): boolean {
  const lowercaseText = text.toLowerCase();
  if (lowercaseText.includes('sale of')) return true;
  
  // Check for presence of at least 3 indicators
  const indicators = [
    'messages-',
    'potential-',
    'appointment-',
    'ph call-',
    'need to follow up-',
    'total income',
    'total sale',
    'sale target',
    'target demand messages',
    'target appointment'
  ];
  let count = 0;
  for (const ind of indicators) {
    if (lowercaseText.includes(ind)) {
      count++;
    }
  }
  return count >= 3;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const settings = await getActiveBotSettings(req);
    if (!settings?.botToken) {
      return NextResponse.json({ error: "Unauthorized bot webhook" }, { status: 401 });
    }
    const callbackQuery = body.callback_query;

    // ─── Handle Callback Queries (Button presses) ─────────────────────
    if (callbackQuery?.data && callbackQuery.from) {
      const sender = await upsertSender(callbackQuery.from, settings.userId);
      const chatId = callbackQuery.message?.chat?.id;
      const messageId = callbackQuery.message?.message_id;
      const data = callbackQuery.data;

      // ─── Guard: Check Authorization ─────────────────────────────────
      const isAuthorized = await checkAuthorization(sender, settings?.botToken, chatId ? BigInt(chatId) : 0);
      if (!isAuthorized) {
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Unauthorized');
        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('data_approval_open:')) {
        const pendingId = data.replace('data_approval_open:', '');

        if (!sender.isDataApprover) {
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Data approver permission required');
          return NextResponse.json({ ok: true });
        }

        const pending = await prisma.pendingDemandImport.findUnique({
          where: { id: pendingId },
          include: { sender: { select: { userId: true, displayName: true, firstName: true } } },
        });
        const isBelongs = pending ? isPendingImportBelongsToApprover(pending.sender.userId, sender.userId, settings?.userId) : false;
        if (!pending || !isBelongs || pending.senderId === sender.id || pending.status !== 'pending_owner_review') {
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'This submission is no longer awaiting review');
          return NextResponse.json({ ok: true });
        }

        const recordCount = isStructuredSubmission(pending.reportType)
          ? structuredSubmissionCount(pending)
          : Array.isArray(pending.parsedRows) ? pending.parsedRows.length : 0;
        const submitterName = pending.sender.displayName || pending.sender.firstName || 'Staff member';
        const itemLabel = isTextSubmission(pending) ? 'Record' : 'File';

        // A pending-list entry may be opened hours later, so forward/copy the
        // source again here rather than relying on the original notification.
        await deliverApprovalFile({ pending, approverChatId: sender.telegramUserId!, botToken: settings.botToken });
        await sendTelegramMessage({
          botToken: settings.botToken,
          chatId: sender.telegramUserId!,
          text: [
            '🧾 <b>Data approval required</b>',
            '━━━━━━━━━━━━━━━━━━━━',
            `👤 <b>Submitted by:</b> ${escapeHtml(submitterName)}`,
            `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
            `📁 <b>Mode:</b> ${approvalReportTypeTitle(pending.reportType)}`,
            `📊 <b>Records:</b> <code>${recordCount}</code>`,
            '',
            'Data format ကိုစစ်ဆေးပြီး approval ပြုလုပ်ပါ။',
          ].join('\n'),
          replyMarkup: {
            inline_keyboard: [[
              { text: '✅ Approve & Import', callback_data: `data_approval_approve:${pending.id}` },
              { text: '❌ Reject', callback_data: `data_approval_reject:${pending.id}` },
            ]],
          },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Approval request opened');
        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('data_approval_approve:') || data.startsWith('data_approval_reject:')) {
        const isApprove = data.startsWith('data_approval_approve:');
        const pendingId = data.replace(isApprove ? 'data_approval_approve:' : 'data_approval_reject:', '');

        if (!sender.isDataApprover) {
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Data approver permission required');
          return NextResponse.json({ ok: true });
        }

        const pending = await prisma.pendingDemandImport.findUnique({
          where: { id: pendingId },
          include: {
            sender: { select: { userId: true } },
            approver: { select: { displayName: true, firstName: true, email: true } },
          },
        });
        const isBelongs = pending ? isPendingImportBelongsToApprover(pending.sender.userId, sender.userId, settings?.userId) : false;
        if (!pending || !isBelongs || pending.status !== 'pending_owner_review') {
          // Provide a context-aware message so the second approver knows who already handled this
          if (pending && isBelongs && pending.status !== 'pending_owner_review') {
            const handledByName = pending.approver?.displayName || pending.approver?.firstName || pending.approver?.email || 'another approver';
            const statusLabel = pending.status === 'approved' ? `✅ Approved by ${handledByName}` : pending.status === 'rejected' ? `❌ Rejected by ${handledByName}` : 'Already handled';
            const isText = isTextSubmission(pending);
            const itemLabel = isText ? 'Record' : 'File';
            await answerCallbackQuery(settings?.botToken, callbackQuery.id, `${statusLabel} — no action needed`);
            if (chatId && messageId) {
              await editTelegramMessage({
                botToken: settings.botToken,
                chatId: BigInt(chatId),
                messageId,
                text: [
                  `ℹ️ <b>${itemLabel} submission already handled</b>`,
                  '━━━━━━━━━━━━━━━━━━━━',
                  `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
                  '',
                  statusLabel,
                  '',
                  'No further action is needed for this submission.',
                ].join('\n'),
              });
            }
          } else {
            await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'This submission is no longer awaiting review');
          }
          return NextResponse.json({ ok: true });
        }

        if (pending.senderId === sender.id) {
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'You cannot approve your own submission');
          return NextResponse.json({ ok: true });
        }

        const reviewerName = sender.displayName || sender.firstName || sender.email || 'Data approver';
        const isText = isTextSubmission(pending);
        const itemLabel = isText ? 'Record' : 'File';

        if (!isApprove) {
          await prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'awaiting_rejection_reason' },
          });
          await prisma.telegramSender.update({
            where: { id: sender.id },
            data: { activeReportType: `awaiting_rejection_reason:${pending.id}` },
          });
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Please enter a rejection reason');
          if (chatId && messageId) {
            await editTelegramMessage({
              botToken: settings.botToken,
              chatId: BigInt(chatId),
              messageId,
              text: [
                '✍️ <b>Rejection reason required</b>',
                '━━━━━━━━━━━━━━━━━━━━',
                `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
                '',
                'Reason ကို စာတစ်စောင်အဖြစ် ရိုက်ပို့ပါ။ အဲဒီစာကို staff ဆီသို့ reject notification နှင့်အတူ ပို့ပေးပါမည်။',
                'မပယ်ဖျက်လိုလျှင် <code>/cancel</code> ရိုက်ပို့ပါ။',
              ].join('\n'),
            });
          }
          return NextResponse.json({ ok: true });
        }

        if (isStructuredSubmission(pending.reportType)) {
          const importedCount = await importStructuredSubmission(pending, settings.userId, new Date());
          await prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'approved', approverId: sender.id, reviewedAt: new Date(), reviewNote: `Approved by ${reviewerName}` },
          });
          await sendTelegramMessage({
            botToken: settings.botToken,
            chatId: pending.chatId,
            text: [
              `✅ <b>${itemLabel} submission approved and imported</b>`,
              '━━━━━━━━━━━━━━━━━━━━',
              `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
              `📁 <b>Mode:</b> ${structuredSubmissionTitle(pending.reportType)}`,
              `📊 <b>Imported:</b> <code>${importedCount}</code> records`,
              `👤 <b>Approved by:</b> ${escapeHtml(reviewerName)}`,
            ].join('\n'),
          });
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, `Imported ${importedCount} records`);
          if (chatId && messageId) {
            await editTelegramMessage({
              botToken: settings.botToken,
              chatId: BigInt(chatId),
              messageId,
              text: [
                `✅ <b>${itemLabel} submission approved</b>`,
                '━━━━━━━━━━━━━━━━━━━━',
                `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
                `📁 <b>Mode:</b> ${structuredSubmissionTitle(pending.reportType)}`,
                `📊 <b>Imported:</b> <code>${importedCount}</code> records`,
              ].join('\n'),
            });
          }
          await notifyOtherApprovers({
            actingApproverId: sender.id,
            pending,
            actionText: `✅ <b>Approved by:</b> ${escapeHtml(reviewerName)} — ${importedCount} records imported.`,
            botToken: settings.botToken,
            ownerUserId: settings.userId,
          });
          return NextResponse.json({ ok: true });
        }

        const rows = Array.isArray(pending.parsedRows)
          ? pending.parsedRows.map((row) => hydrateParsedDemand(row as Record<string, unknown>))
          : [];
        if (rows.length === 0) {
          await prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'cancelled', approverId: sender.id, reviewedAt: new Date(), reviewNote: 'No rows to import' },
          });
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'No rows to import');
          return NextResponse.json({ ok: true });
        }

        const importBatch = await prisma.demandImportBatch.create({
          data: {
            fileName: pending.fileName,
            fileType: pending.fileType,
            status: 'imported',
            source: 'telegram_file',
            detectedColumns: Prisma.JsonNull,
            columnMapping: Prisma.JsonNull,
            rowCount: rows.length,
            importedCount: 0,
            uploadedByUserId: settings.userId,
          },
        });
        await prisma.qADocument.create({
          data: {
            userId: settings.userId,
            title: `📎 ${pending.fileName}`,
            content: pending.extractedText.slice(0, 10000),
            source: 'telegram_file',
            fileType: pending.fileType,
            fileName: pending.fileName,
            senderId: pending.senderId,
          },
        });
        const importedCount = await createDemandRecordsFromParsedDemands({
          parsedDemands: rows,
          senderId: pending.senderId,
          telegramMessageId: pending.messageId,
          fileName: pending.fileName,
          sourceType: 'telegram_file',
          reportType: pending.reportType,
          importBatchId: importBatch.id,
          ownerUserId: settings.userId,
        });
        await Promise.all([
          prisma.demandImportBatch.update({ where: { id: importBatch.id }, data: { importedCount } }),
          prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'approved', approverId: sender.id, reviewedAt: new Date(), reviewNote: `Approved by ${reviewerName}` },
          }),
        ]);
        await sendTelegramMessage({
          botToken: settings.botToken,
          chatId: pending.chatId,
          text: [
            `✅ <b>${itemLabel} submission approved and imported</b>`,
            '━━━━━━━━━━━━━━━━━━━━',
            `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
            `📊 <b>Imported:</b> <code>${importedCount}</code> records`,
            `👤 <b>Approved by:</b> ${escapeHtml(reviewerName)}`,
          ].join('\n'),
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, `Imported ${importedCount} records`);
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              `✅ <b>${itemLabel} submission approved</b>`,
              '━━━━━━━━━━━━━━━━━━━━',
              `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
              `📊 <b>Imported:</b> <code>${importedCount}</code> records`,
              '',
              `Staff member ကို approval အကြောင်းကြားပြီး dashboard ထဲသို့ data သွင်းပြီးပါပြီ။`,
            ].join('\n'),
          });
        }
        await notifyOtherApprovers({
          actingApproverId: sender.id,
          pending,
          actionText: `✅ <b>Approved by:</b> ${escapeHtml(reviewerName)} — ${importedCount} records imported.`,
          botToken: settings.botToken,
          ownerUserId: settings.userId,
        });
        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('demand_import_confirm:')) {
        const pendingId = data.replace('demand_import_confirm:', '');
        const pending = await prisma.pendingDemandImport.findUnique({
          where: { id: pendingId },
        });

        if (!pending) {
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Preview not found');
          return NextResponse.json({ ok: true });
        }

        if (pending.status !== 'pending') {
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, `Already ${pending.status}`);
          return NextResponse.json({ ok: true });
        }

        if (pending.expiresAt < new Date()) {
          await prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'expired' },
          });
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Preview expired');
          const isText = isTextSubmission(pending);
          const itemLabel = isText ? 'Record' : 'File';
          if (chatId && messageId) {
            await editTelegramMessage({
              botToken: settings?.botToken,
              chatId: BigInt(chatId),
              messageId,
              text: [
                `⌛ <b>Sales & Marketing ${itemLabel.toLowerCase()} preview expired</b>`,
                "━━━━━━━━━━━━━━━━━━━━",
                `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
                `ကျေးဇူးပြု၍ ${isText ? 'data' : 'file'} ကိုပြန်ပို့ပြီး preview အသစ်လုပ်ပါ။`,
              ].join("\n"),
            });
          }
          return NextResponse.json({ ok: true });
        }

        const rows = Array.isArray(pending.parsedRows)
          ? pending.parsedRows.map((row) => hydrateParsedDemand(row as Record<string, unknown>))
          : [];

        if (isStructuredSubmission(pending.reportType)) {
          const structuredKind = pending.reportType;
          const recordCount = structuredSubmissionCount(pending);
          if (recordCount === 0) {
            await prisma.pendingDemandImport.update({ where: { id: pending.id }, data: { status: 'cancelled' } });
            await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'No records to import');
            return NextResponse.json({ ok: true });
          }
          const isText = isTextSubmission(pending);
          const itemLabel = isText ? 'Record' : 'File';
          const approvers = await getIndependentDataApprovers(pending.senderId, settings.userId);
          if (approvers.length === 0) {
            const importedCount = await importStructuredSubmission(pending, settings.userId, new Date());
            await prisma.pendingDemandImport.update({ where: { id: pending.id }, data: { status: 'confirmed', reviewNote: 'Imported directly: no Data Approver configured' } });
            await answerCallbackQuery(settings?.botToken, callbackQuery.id, `Imported ${importedCount} records`);
            if (chatId && messageId) await editTelegramMessage({
              botToken: settings?.botToken, chatId: BigInt(chatId), messageId,
              text: [`✅ <b>${itemLabel} imported</b>`, '━━━━━━━━━━━━━━━━━━━━', `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`, `📁 <b>Mode:</b> ${structuredSubmissionTitle(structuredKind)}`, `📊 <b>Imported:</b> <code>${importedCount}</code> records`, '', 'Independent Data Approver မရှိသေးသဖြင့် dashboard ထဲသို့ တိုက်ရိုက်သွင်းပြီးပါပြီ။'].join('\n'),
            });
            return NextResponse.json({ ok: true });
          }
          await prisma.pendingDemandImport.update({ where: { id: pending.id }, data: { status: 'pending_owner_review' } });
          await Promise.all(approvers.map(async (approver) => {
            await deliverApprovalFile({ pending, approverChatId: approver.telegramUserId!, botToken: settings.botToken });
            return sendTelegramMessage({
            botToken: settings.botToken, chatId: approver.telegramUserId!,
            text: ['🧾 <b>Data approval required</b>', '━━━━━━━━━━━━━━━━━━━━', `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`, `📁 <b>Mode:</b> ${structuredSubmissionTitle(structuredKind)}`, `📊 <b>Records:</b> <code>${recordCount}</code>`, '', 'Data format ကိုစစ်ဆေးပြီး approval ပြုလုပ်ပါ။'].join('\n'),
            replyMarkup: { inline_keyboard: [[{ text: '✅ Approve & Import', callback_data: `data_approval_approve:${pending.id}` }, { text: '❌ Reject', callback_data: `data_approval_reject:${pending.id}` }]] },
            });
          }));
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Sent for data approval');
          if (chatId && messageId) await editTelegramMessage({
            botToken: settings?.botToken, chatId: BigInt(chatId), messageId,
            text: [`⏳ <b>${itemLabel} submitted for approval</b>`, '━━━━━━━━━━━━━━━━━━━━', `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`, `📁 <b>Mode:</b> ${structuredSubmissionTitle(structuredKind)}`, `📊 <b>Records submitted:</b> <code>${recordCount}</code>`, '', 'Data Approver ဆီသို့ notification ပို့ပြီးပါပြီ။ Approve လုပ်ပြီးမှ dashboard ထဲသို့ data ဝင်ပါမည်။'].join('\n'),
          });
          return NextResponse.json({ ok: true });
        }

        if (rows.length === 0) {
          await prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'cancelled' },
          });
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'No rows to import');
          return NextResponse.json({ ok: true });
        }

        const summary = summarizeParsedDemands(rows);
        const approvers = await getIndependentDataApprovers(pending.senderId, settings.userId);

        // Until at least one independent Data Approver is configured, retain
        // the original direct-import behavior so business reporting is not blocked.
        if (approvers.length === 0) {
          const importBatch = await prisma.demandImportBatch.create({
            data: {
              fileName: pending.fileName,
              fileType: pending.fileType,
              status: 'imported',
              source: 'telegram_file',
              detectedColumns: Prisma.JsonNull,
              columnMapping: Prisma.JsonNull,
              rowCount: rows.length,
              importedCount: 0,
              uploadedByUserId: settings.userId,
            },
          });
          await prisma.qADocument.create({
            data: {
              userId: settings.userId,
              title: `📎 ${pending.fileName}`,
              content: pending.extractedText.slice(0, 10000),
              source: 'telegram_file',
              fileType: pending.fileType,
              fileName: pending.fileName,
              senderId: pending.senderId,
            },
          });
          const importedCount = await createDemandRecordsFromParsedDemands({
            parsedDemands: rows,
            senderId: pending.senderId,
            telegramMessageId: pending.messageId,
            fileName: pending.fileName,
            sourceType: 'telegram_file',
            reportType: pending.reportType,
            importBatchId: importBatch.id,
            ownerUserId: settings.userId,
          });
          await Promise.all([
            prisma.demandImportBatch.update({ where: { id: importBatch.id }, data: { importedCount } }),
            prisma.pendingDemandImport.update({
              where: { id: pending.id },
              data: { status: 'confirmed', reviewNote: 'Imported directly: no Data Approver configured' },
            }),
          ]);
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, `Imported ${importedCount} records`);
          const isText = isTextSubmission(pending);
          const itemLabel = isText ? 'Record' : 'File';
          if (chatId && messageId) {
            await editTelegramMessage({
              botToken: settings?.botToken,
              chatId: BigInt(chatId),
              messageId,
              text: [
                `✅ <b>${itemLabel} imported</b>`,
                '━━━━━━━━━━━━━━━━━━━━',
                `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
                `📊 <b>Imported:</b> <code>${importedCount}</code> records`,
                '',
                'Data Approver မသတ်မှတ်ထားသေးသဖြင့် အရင် flow အတိုင်း dashboard ထဲသို့ တိုက်ရိုက်သွင်းပြီးပါပြီ။',
              ].join('\n'),
            });
          }
          return NextResponse.json({ ok: true });
        }

        await prisma.pendingDemandImport.update({
          where: { id: pending.id },
          data: { status: 'pending_owner_review' },
        });
        const isText = isTextSubmission(pending);
        const itemLabel = isText ? 'Record' : 'File';
        await Promise.all(approvers.map(async (approver) => {
          await deliverApprovalFile({ pending, approverChatId: approver.telegramUserId!, botToken: settings.botToken });
          return sendTelegramMessage({
          botToken: settings.botToken,
          chatId: approver.telegramUserId!,
          text: [
            '🧾 <b>Data approval required</b>',
            '━━━━━━━━━━━━━━━━━━━━',
            `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
            `📊 <b>Rows:</b> <code>${rows.length}</code>`,
            `📁 <b>Department:</b> ${pending.reportType === 'customer_service' ? 'Customer Service' : 'Sales & Marketing'}`,
            '',
            `• High priority: <b>${summary.high}</b>`,
            `• Missing phone: <b>${summary.missingPhone}</b>`,
            `• Missing service: <b>${summary.missingService}</b>`,
            '',
            'Data format ကိုစစ်ဆေးပြီး approval ပြုလုပ်ပါ။',
          ].join('\n'),
          replyMarkup: {
            inline_keyboard: [[
              { text: '✅ Approve & Import', callback_data: `data_approval_approve:${pending.id}` },
              { text: '❌ Reject', callback_data: `data_approval_reject:${pending.id}` },
            ]],
          },
          });
        }));

        await answerCallbackQuery(
          settings?.botToken,
          callbackQuery.id,
          'Sent for owner review',
        );
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              `⏳ <b>${itemLabel} submitted for approval</b>`,
              "━━━━━━━━━━━━━━━━━━━━",
              `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
              `📊 <b>Rows submitted:</b> <code>${rows.length}</code>`,
              "",
              "Data Approver ဆီသို့ notification ပို့ပြီးပါပြီ။ Approve လုပ်ပြီးမှ dashboard ထဲသို့ data ဝင်ပါမည်။",
            ].join("\n"),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data.startsWith('demand_import_cancel:')) {
        const pendingId = data.replace('demand_import_cancel:', '');
        const pending = await prisma.pendingDemandImport.findUnique({
          where: { id: pendingId },
        });

        if (!pending) {
          await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Preview not found');
          return NextResponse.json({ ok: true });
        }

        await prisma.pendingDemandImport.update({
          where: { id: pending.id },
          data: { status: 'cancelled' },
        });

        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Import cancelled');
        const isText = isTextSubmission(pending);
        const itemLabel = isText ? 'Record' : 'File';
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              `❌ <b>Sales & Marketing ${itemLabel.toLowerCase()} import cancelled</b>`,
              "━━━━━━━━━━━━━━━━━━━━",
              `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
              `Dashboard ထဲသို့ data မသွင်းထားပါ။ ${isText ? 'Data' : 'File'} ကိုပြင်ပြီးပြန်ပို့နိုင်ပါသည်။`,
            ].join("\n"),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:qa') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'qa' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Q&A Mode selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              "🤖 ━━━━━━━━━━━━━━━━━━━━",
              "",
              "  <b>Q&A Mode — အသက်ဝင်ပါပြီ</b>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "Gemini AI မှ လုပ်ငန်းဒေတာကို",
              "အခြေခံ၍ ဖြေကြားပေးမည်။",
              "",
              "💬 <b>ဥပမာများ:</b>",
              "",
              "  • <i>domain / hosting ရက်နီးဆုံးများ?</i>",
              "  • <i>update ကျန်တဲ့ website ရှိလား?</i>",
              "  • <i>follow-up လုပ်ရမယ့် customer?</i>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
            ].join("\n"),
            replyMarkup: {
              inline_keyboard: [
                [{ text: "↩️ Main Menu", callback_data: "action:menu" }]
              ]
            }
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:demand_report') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'demand_report' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Sales & Marketing selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getFormatPrompt(),
            replyMarkup: buildFormatInlineButtons('demand_report'),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:customer_service') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'customer_service' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Customer Service selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getCustomerServiceFormatPrompt(),
            replyMarkup: buildFormatInlineButtons('customer_service'),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:project_service_tracking') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'project_service_tracking' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Project & Service Tracking selected');
        const prompt = getProjectServiceTrackingFormatPrompt();
        const replyMarkup = buildFormatInlineButtons('project_service_tracking');
        if (chatId && messageId) {
          const wasUpdated = await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: prompt,
            replyMarkup,
          });
          // If Telegram cannot edit the menu message (for example, because the
          // original is too old), always show the selected mode as a new message.
          if (!wasUpdated) {
            await sendTelegramMessage({
              botToken: settings?.botToken,
              chatId: BigInt(chatId),
              text: prompt,
              replyMarkup,
            });
          }
        } else if (chatId) {
          await sendTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            text: prompt,
            replyMarkup,
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:project_expiry' || data === 'mode:website_update') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'project_service_tracking' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Project & Service Tracking selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getProjectServiceTrackingFormatPrompt(),
            replyMarkup: buildFormatInlineButtons('project_service_tracking'),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:finance_transactions') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'finance_transactions' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Finance Transactions selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getFinanceTransactionsFormatPrompt(),
            replyMarkup: buildFormatInlineButtons('finance_transactions'),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:business_report') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'business_report' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Business KPI Report selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getBusinessReportFormatPrompt(),
            replyMarkup: buildFormatInlineButtons('business_report'),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'action:template') {
        const templateText = getCopyPasteTemplateForMode(sender.activeReportType);
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Copy template below');
        
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: templateText,
          replyMarkup: {
            inline_keyboard: [
              [{ text: "↩️ Back to Menu", callback_data: "action:menu" }]
            ]
          }
        });
        return NextResponse.json({ ok: true });
      }

      if (data === 'action:menu') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'none' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Main Menu');
        const allowedButtons = buildMainMenuButtons(sender.allowedDepartments);
        
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              "👋 ━━━━━━━━━━━━━━━━━━━━",
              "",
              `  <b>မင်္ဂလာပါ ${sender.displayName || 'ခင်ဗျာ/ရှင်'}</b>`,
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "အောက်ပါ Menu မှ လုပ်ဆောင်လိုသည့်",
              "လုပ်ငန်းစဉ်အမျိုးအစားကို ရွေးချယ်ပါ။",
            ].join("\n"),
            replyMarkup: allowedButtons,
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

    if (!hasText && !hasFile) {
      return NextResponse.json({ ok: true });
    }

    const from = message.from;
    if (!from) return NextResponse.json({ ok: true });

    const sender = await upsertSender(from, settings.userId);
    const chatId = BigInt(message.chat.id);

    // ─── Handle Auth & OTP Command States (Bypasses general authorization) ──
    if (message.text) {
      const text = message.text.trim();

      // 1. Command: /unlink (Unlinks current account)
      if (text === '/unlink') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: {
            email: null,
            isVerified: false,
            isAuthorized: false,
            activeReportType: 'none',
            otpCode: null,
            otpExpiresAt: null,
          },
        });
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: [
            "🔓 ━━━━━━━━━━━━━━━━━━━━",
            "",
            "  <b>အကောင့် ချိတ်ဆက်မှု ဖြုတ်ပြီးပါပြီ</b>",
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            "ယခု Telegram account ကို စနစ်မှ",
            "အောင်မြင်စွာ ဖြုတ်လိုက်ပြီး ဖြစ်သည်။",
          ].join("\n"),
          replyMarkup: KEYBOARD_UNLINKED,
        });
        return NextResponse.json({ ok: true });
      }

      // 2. Command: /link (Starts verification process)
      if (text === '/link') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'awaiting_email' },
        });
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: [
            "🔐 ━━━━━━━━━━━━━━━━━━━━",
            "",
            "  <b>အကောင့် ချိတ်ဆက်ခြင်း</b>",
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            "စနစ်တွင် စာရင်းသွင်းထားသော",
            "သင့်ဝန်ထမ်း အီးမေးလ်ကို ရိုက်ထည့်ပေးပါ။",
          ].join("\n"),
          replyMarkup: KEYBOARD_UNLINKED,
        });
        return NextResponse.json({ ok: true });
      }

      // 3. State: Awaiting Email input
      if (sender.activeReportType === 'awaiting_email') {
        const email = text;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
          await sendTelegramMessage({
            botToken: settings?.botToken,
            chatId,
            text: [
              "⚠️ ━━━━━━━━━━━━━━━━━━━━",
              "",
              "  <b>အီးမေးလ် ပုံစံမမှန်ပါ</b>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "ကျေးဇူးပြု၍ အီးမေးလ် မှန်ကန်စွာ ရိုက်ထည့်ပါ။",
              "ဥပမာ: <code>name@company.com</code>",
            ].join("\n"),
            replyMarkup: KEYBOARD_UNLINKED,
          });
          return NextResponse.json({ ok: true });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Find a pre-registered TelegramSender where either:
        // 1. email matches and telegramUserId is NULL
        // 2. email matches and telegramUserId matches the sender's telegramUserId
        const preRegisteredSender = await prisma.telegramSender.findFirst({
          where: {
            userId: settings.userId,
            email: normalizedEmail,
            OR: [
              { telegramUserId: null },
              { telegramUserId: sender.telegramUserId },
            ],
          },
        });

        if (!preRegisteredSender) {
          await sendTelegramMessage({
            botToken: settings?.botToken,
            chatId,
            text: [
              "❌ ━━━━━━━━━━━━━━━━━━━━",
              "",
              "  <b>ဝင်ရောက်ခွင့်မရှိပါ</b>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              `ဤအီးမေးလ် <code>${email}</code> ကို HR & Staff တွင်`,
              "Business Owner မှ ကြိုတင်ထည့်သွင်းထားခြင်း မရှိပါ။",
              "",
              "💡 <i>ကျေးဇူးပြု၍ သင့်လုပ်ငန်းတာဝန်ရှိသူအား</i>",
              "<i>HR & Staff တွင် စာရင်းသွင်းပေးရန် ပြောပါ။</i>",
            ].join("\n"),
            replyMarkup: KEYBOARD_UNLINKED,
          });
          return NextResponse.json({ ok: true });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: {
            email: normalizedEmail,
            otpCode: otp,
            otpExpiresAt,
            activeReportType: 'awaiting_otp',
            isVerified: false,
          },
        });

        const emailSent = await sendOTPEmail(email, otp);
        if (emailSent) {
          // Mask email for display e.g. kc***@gmail.com
          const atIndex = email.indexOf('@');
          let maskedEmail = email;
          if (atIndex > 2) {
            maskedEmail = email.slice(0, 2) + '***' + email.slice(atIndex);
          }

          await sendTelegramMessage({
            botToken: settings?.botToken,
            chatId,
            text: [
              "📩 ━━━━━━━━━━━━━━━━━━━━",
              "",
              "  <b>အတည်ပြုကုဒ် ပို့ပြီးပါပြီ</b>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              `သင့်အီးမေးလ် <code>${maskedEmail}</code> သို့`,
              "ဂဏန်း ၆ လုံးပါ OTP ပို့ပေးထားပါသည်။",
              "",
              "📝 <b>လုပ်ဆောင်ရန်:</b>",
              "  ရရှိလာသော အတည်ပြုကုဒ်ကို ရိုက်ပို့ပါ။",
            ].join("\n"),
            replyMarkup: KEYBOARD_UNLINKED,
          });
        } else {
          await sendTelegramMessage({
            botToken: settings?.botToken,
            chatId,
            text: [
              "❌ ━━━━━━━━━━━━━━━━━━━━",
              "",
              "  <b>အီးမေးလ် မပို့နိုင်ပါ</b>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "အီးမေးလ်ပို့ခြင်း မအောင်မြင်ပါ။",
              "Business Owner အား ဆက်သွယ်ပါ။",
            ].join("\n"),
            replyMarkup: KEYBOARD_UNLINKED,
          });
        }
        return NextResponse.json({ ok: true });
      }

      // 4. State: Awaiting OTP input
      if (sender.activeReportType === 'awaiting_otp') {
        const code = text;

        if (!code || !/^\d{6}$/.test(code)) {
          await sendTelegramMessage({
            botToken: settings?.botToken,
            chatId,
            text: [
              "⚠️ ━━━━━━━━━━━━━━━━━━━━",
              "",
              "  <b>ကုဒ် ပုံစံမမှန်ပါ</b>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "ဂဏန်း ၆ လုံးပါသော OTP ကို ရိုက်ပို့ပါ။",
            ].join("\n"),
            replyMarkup: KEYBOARD_UNLINKED,
          });
          return NextResponse.json({ ok: true });
        }

        if (sender.otpCode !== code || !sender.otpExpiresAt || sender.otpExpiresAt < new Date()) {
          await sendTelegramMessage({
            botToken: settings?.botToken,
            chatId,
            text: [
              "❌ ━━━━━━━━━━━━━━━━━━━━",
              "",
              "  <b>အတည်ပြုခြင်း မအောင်မြင်ပါ</b>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "",
              "ကုဒ်မှားယွင်းနေပါသည် သို့မဟုတ်",
              "သက်တမ်းကုန်ဆုံးသွားပါပြီ။",
            ].join("\n"),
            replyMarkup: KEYBOARD_UNLINKED,
          });
          return NextResponse.json({ ok: true });
        }

        // Verification Success
        const preRegistered = await prisma.telegramSender.findFirst({
          where: {
            userId: settings.userId,
            email: sender.email,
            OR: [
              { telegramUserId: null },
              { telegramUserId: sender.telegramUserId },
            ],
          },
        });

        if (preRegistered) {
          const displayName = displayNameFromTelegramUser(from);
          if (preRegistered.id !== sender.id) {
            // Merge the pre-registered record's permissions INTO the active
            // Telegram sender (which already owns messages, demand records, etc.)
            // then delete the empty placeholder to avoid duplicates.
            await prisma.telegramSender.update({
              where: { id: sender.id },
              data: {
                firstName: from.first_name || "Unknown",
                lastName: from.last_name || null,
                username: from.username || null,
                displayName: displayName || "Unknown",
                userId: settings.userId,
                email: sender.email,
                isVerified: true,
                isAuthorized: preRegistered.isAuthorized,
                isDataApprover: preRegistered.isDataApprover,
                allowedDepartments: preRegistered.allowedDepartments,
                activeReportType: 'none',
                otpCode: null,
                otpExpiresAt: null,
              },
            });

            // Delete the empty pre-registered placeholder (no linked data)
            await prisma.telegramSender.delete({
              where: { id: preRegistered.id },
            });
          } else {
            // They were already on the same record (e.g. re-linking)
            await prisma.telegramSender.update({
              where: { id: sender.id },
              data: {
                isVerified: true,
                isAuthorized: true,
                activeReportType: 'none',
                otpCode: null,
                otpExpiresAt: null,
              },
            });
          }
        }

        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: [
            "✅ ━━━━━━━━━━━━━━━━━━━━",
            "",
            "  <b>အကောင့် ချိတ်ဆက်ပြီးပါပြီ</b>",
            "",
            "━━━━━━━━━━━━━━━━━━━━",
            "",
            `အီးမေးလ်: <code>${sender.email}</code>`,
            "အတည်ပြု ချိတ်ဆက်ခြင်း အောင်မြင်ပါသည်။",
            "",
            "💡 <i>အောက်ခြေရှိ Menu မှတစ်ဆင့်</i>",
            "<i>လုပ်ငန်းစဉ်များကို စတင်ဆောင်ရွက်နိုင်ပါပြီ။</i>",
          ].join("\n"),
          replyMarkup: KEYBOARD_LINKED,
        });
        return NextResponse.json({ ok: true });
      }
    }

    // ─── Guard: Check General Authorization ───────────────────────────
    const isAuthorized = await checkAuthorization(sender, settings?.botToken, chatId);
    if (!isAuthorized) {
      return NextResponse.json({ ok: true });
    }

    // ─── Data approver: collect a custom rejection reason ─────────────
    if (message.text && sender.activeReportType.startsWith('awaiting_rejection_reason:')) {
      const pendingId = sender.activeReportType.replace('awaiting_rejection_reason:', '');
      const reason = message.text.trim();
      const pending = await prisma.pendingDemandImport.findUnique({
        where: { id: pendingId },
        include: { sender: { select: { userId: true } } },
      });
      const isBelongs = pending ? isPendingImportBelongsToApprover(pending.sender.userId, sender.userId, settings?.userId) : false;

      if (!sender.isDataApprover || !pending || !isBelongs || pending.status !== 'awaiting_rejection_reason' || pending.senderId === sender.id) {
        await prisma.telegramSender.update({ where: { id: sender.id }, data: { activeReportType: 'none' } });
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: 'This approval request is no longer available.',
        });
        return NextResponse.json({ ok: true });
      }

      if (reason === '/cancel') {
        await Promise.all([
          prisma.pendingDemandImport.update({ where: { id: pending.id }, data: { status: 'pending_owner_review' } }),
          prisma.telegramSender.update({ where: { id: sender.id }, data: { activeReportType: 'none' } }),
        ]);
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: '↩️ Rejection cancelled. This submission is available for approval again.',
        });
        return NextResponse.json({ ok: true });
      }

      if (!reason || reason.length > 1000) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: 'Please enter a clear rejection reason (up to 1,000 characters), or send /cancel.',
        });
        return NextResponse.json({ ok: true });
      }

      const reviewerName = sender.displayName || sender.firstName || sender.email || 'Data approver';
      const isText = isTextSubmission(pending);
      const itemLabel = isText ? 'Record' : 'File';
      await Promise.all([
        prisma.pendingDemandImport.update({
          where: { id: pending.id },
          data: {
            status: 'rejected',
            approverId: sender.id,
            reviewedAt: new Date(),
            reviewNote: reason,
          },
        }),
        prisma.telegramSender.update({ where: { id: sender.id }, data: { activeReportType: 'none' } }),
      ]);
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId: pending.chatId,
        text: [
          `❌ <b>${itemLabel} submission rejected</b>`,
          '━━━━━━━━━━━━━━━━━━━━',
          `📎 <b>${itemLabel}:</b> <code>${escapeHtml(pending.fileName)}</code>`,
          `👤 <b>Reviewed by:</b> ${escapeHtml(reviewerName)}`,
          '',
          '<b>Reason:</b>',
          escapeHtml(reason),
          '',
          `Reason ကိုအခြေခံပြီး ${isText ? 'data format' : 'file/data format'} ပြင်ကာ preview အသစ်ဖြင့် ပြန်လည်ပို့ပေးပါ။`,
        ].join('\n'),
      });
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: `✅ Rejection reason sent to the staff member for <code>${escapeHtml(pending.fileName)}</code>.`,
      });
      await notifyOtherApprovers({
        actingApproverId: sender.id,
        pending,
        actionText: `❌ <b>Rejected by:</b> ${escapeHtml(reviewerName)}.`,
        botToken: settings?.botToken,
        ownerUserId: settings?.userId,
      });
      return NextResponse.json({ ok: true });
    }

    // Guard: Check if sender has any allowed departments
    if (!sender.allowedDepartments || sender.allowedDepartments.length === 0) {
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: [
          "⏳ ━━━━━━━━━━━━━━━━━━━━",
          "",
          "  <b>ခွင့်ပြုချက် စောင့်ဆိုင်းနေပါသည်</b>",
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "",
          `အီးမေးလ်: <code>${sender.email}</code> (အတည်ပြုပြီး)`,
          "",
          "စနစ်ကိုသုံးရန် မည်သည့်ဌာနအတွက်မျှ",
          "ခွင့်ပြုချက် မရရှိသေးပါ။",
          "",
          "💡 <i>ကျေးဇူးပြု၍ Business Owner အား</i>",
          "<i>ဆက်သွယ်ပြီး ခွင့်ပြုချက် တောင်းဆိုပါ။</i>",
        ].join("\n"),
        replyMarkup: KEYBOARD_UNLINKED,
      });
      return NextResponse.json({ ok: true });
    }

    if (message.text === '/pending') {
      if (!sender.isDataApprover) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: '🔒 <b>Pending approvals</b> ကို Data Approver permission ရှိသော account များသာ ကြည့်နိုင်ပါသည်။',
        });
        return NextResponse.json({ ok: true });
      }

      const ownerUserId = sender.userId ?? settings?.userId;
      const pendingWhere = {
        status: { in: ['pending_owner_review', 'awaiting_rejection_reason'] },
        senderId: { not: sender.id },
        ...(ownerUserId
          ? {
              sender: {
                OR: [
                  { userId: ownerUserId },
                  { userId: null },
                ],
              },
            }
          : {}),
      };
      const [totalPending, pendingItems] = await Promise.all([
        prisma.pendingDemandImport.count({ where: pendingWhere }),
        prisma.pendingDemandImport.findMany({
          where: pendingWhere,
          orderBy: { createdAt: 'asc' },
          take: 10,
          include: { sender: { select: { displayName: true, firstName: true } } },
        }),
      ]);

      if (totalPending === 0) {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: [
            '✅ <b>Pending approvals</b>',
            '━━━━━━━━━━━━━━━━━━━━',
            'လက်ရှိ review စောင့်နေသော staff submission မရှိပါ။',
          ].join('\n'),
        });
        return NextResponse.json({ ok: true });
      }

      const list = pendingItems.map((item, index) => {
        const submitter = item.sender.displayName || item.sender.firstName || 'Staff member';
        const count = isStructuredSubmission(item.reportType)
          ? structuredSubmissionCount(item)
          : Array.isArray(item.parsedRows) ? item.parsedRows.length : 0;
        const itemLabel = isTextSubmission(item) ? 'Record' : 'File';
        return `${index + 1}. <b>${escapeHtml(submitter)}</b> — ${approvalReportTypeTitle(item.reportType)}\n   📎 <b>${itemLabel}:</b> <code>${escapeHtml(item.fileName)}</code> · ${count} records`;
      });

      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: [
          `⏳ <b>Pending approvals (${totalPending})</b>`,
          '━━━━━━━━━━━━━━━━━━━━',
          ...list,
          ...(totalPending > pendingItems.length ? ['', `ပထမ ${pendingItems.length} ခုကို ပြထားပါသည်။`] : []),
          '',
          'Review ကိုနှိပ်၍ file/text ကိုပြန်ကြည့်ပြီး approve သို့မဟုတ် reject လုပ်နိုင်ပါသည်။',
        ].join('\n'),
        replyMarkup: {
          inline_keyboard: pendingItems.map((item, index) => [{
            text: `🔎 Review ${index + 1} · ${truncateTelegramLabel(item.sender.displayName || item.sender.firstName || item.fileName)}`,
            callback_data: `data_approval_open:${item.id}`,
          }]),
        },
      });
      return NextResponse.json({ ok: true });
    }

    if (message.text === '/format') {
      const mode = normalizeTelegramReportMode(sender.activeReportType);
      const showButtons = ['project_service_tracking', 'business_report', 'demand_report', 'customer_service', 'finance_transactions'].includes(mode);
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: getFormatPromptForMode(mode),
        ...(showButtons ? { replyMarkup: buildFormatInlineButtons(mode) } : {}),
      });
      return NextResponse.json({ ok: true });
    }

    if (message.text === '/template') {
      const mode = normalizeTelegramReportMode(sender.activeReportType);
      const showButtons = ['project_service_tracking', 'business_report', 'demand_report', 'customer_service', 'finance_transactions'].includes(mode);
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: getCopyPasteTemplateForMode(mode),
        ...(showButtons
          ? {
              replyMarkup: {
                inline_keyboard: [[{ text: "↩️ Back to Menu", callback_data: "action:menu" }]],
              },
            }
          : {}),
      });
      return NextResponse.json({ ok: true });
    }

    if (message.text === '/start' || message.text === '/menu') {
      const allowedButtons = buildMainMenuButtons(sender.allowedDepartments);
      
      // Send bottom custom keyboard initializer first
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: [
          "👋 ━━━━━━━━━━━━━━━━━━━━",
          "",
          `  <b>မင်္ဂလာပါ ${sender.displayName || 'ခင်ဗျာ/ရှင်'}</b>`,
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "",
          "<b>Business AI Integration</b> မှ ကြိုဆိုပါသည်",
        ].join("\n"),
        replyMarkup: KEYBOARD_LINKED,
      });

      // Send inline category keyboard
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: "📂 <b>လုပ်ငန်းစဉ် အမျိုးအစား ရွေးချယ်ပါ:</b>",
        replyMarkup: allowedButtons,
      });
      return NextResponse.json({ ok: true });
    }

    // ─── Handle File Uploads ──────────────────────────────────────────
    if (hasFile && fileInfo) {
      const receivedAt = new Date(message.date * 1000);
      const receivedAtMyanmar = new Date(receivedAt.getTime() + 6.5 * 60 * 60 * 1000);
      const updatedSender = await prisma.telegramSender.update({
        where: { id: sender.id },
        data: {
          messageCount: { increment: 1 },
          lastMessageAt: new Date(),
        },
      });

      const activeMode = normalizeTelegramReportMode(updatedSender.activeReportType);
      if (activeMode !== updatedSender.activeReportType) {
        await prisma.telegramSender.update({ where: { id: sender.id }, data: { activeReportType: activeMode } });
      }

      const requiredDep = getDepartmentForMode(activeMode);
      if (requiredDep && !updatedSender.allowedDepartments.includes(requiredDep)) {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'none' },
        });
        await sendNoPermissionPrompt(settings?.botToken, chatId, requiredDep);
        return NextResponse.json({ ok: true });
      }

      if (activeMode === 'none') {
        await sendPickModePrompt(settings?.botToken, chatId);
        return NextResponse.json({ ok: true });
      }

      if (activeMode === 'qa') {
        await sendTelegramMessage({
          botToken: settings?.botToken,
          chatId,
          text: [
            "⚠️ <b>Q&A မေးမြန်းခြင်း ကဏ္ဍတွင် ဖိုင်များ ပေးပို့၍ မရနိုင်ပါ။</b>",
            "",
            "အစီရင်ခံစာ (Report) တင်သွင်းရန်အတွက် သက်ဆိုင်ရာ mode သို့ ပြောင်းလဲပေးပို့ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
            "/start သို့မဟုတ် /menu ကိုနှိပ်၍ သက်ဆိုင်ရာ mode ကို ရွေးချယ်နိုင်ပါသည်။",
          ].join("\n"),
        });
        return NextResponse.json({ ok: true });
      }

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

      after(async () => {
        try {
          await processFileInBackground({
            downloadedBuffer: downloaded.buffer,
            fileInfo,
            caption,
            settings,
            chatId,
            senderId: sender.id,
            // This foreign key references the stored TelegramMessage row.
            telegramMessageId: telegramMessage.id,
            // Retain Telegram's numeric ID separately for copyMessage.
            sourceTelegramMessageId: String(message.message_id),
            // Keep the bot file ID so the approver can still receive the file
            // if Telegram prevents copying a message between chats.
            sourceTelegramFileId: fileInfo.fileId,
            progressMsgId,
            receivedAtMyanmar,
            activeMode,
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

    const receivedAt = new Date(message.date * 1000);
    const receivedAtMyanmar = new Date(receivedAt.getTime() + 6.5 * 60 * 60 * 1000);
    const updatedSender = await prisma.telegramSender.update({
      where: { id: sender.id },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });

    const isBusinessReport = message.text ? isBusinessReportText(message.text) : false;
    const activeMode = isBusinessReport ? 'business_report' : normalizeTelegramReportMode(updatedSender.activeReportType);
    if (!isBusinessReport && activeMode !== updatedSender.activeReportType) {
      await prisma.telegramSender.update({ where: { id: sender.id }, data: { activeReportType: activeMode } });
    }

    const requiredDep = getDepartmentForMode(activeMode);
    if (requiredDep && !updatedSender.allowedDepartments.includes(requiredDep)) {
      await prisma.telegramSender.update({
        where: { id: sender.id },
        data: { activeReportType: 'none' },
      });
      await sendNoPermissionPrompt(settings?.botToken, chatId, requiredDep);
      return NextResponse.json({ ok: true });
    }

    // ─── No mode selected yet — prompt the user to pick one first ──────
    if (activeMode === 'none') {
      await sendPickModePrompt(settings?.botToken, chatId);
      return NextResponse.json({ ok: true });
    }

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

      const context = await buildQAContext(settings.userId);
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

    // ─── Project & Service Tracking Mode (text) ────────────────────────
    if (activeMode === 'project_service_tracking') {
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

      const [parsedExpiry, parsedUpdate] = await Promise.all([
        parseProjectExpiryMessageWithGemini({
          text: message.text,
          apiKey: settings?.geminiApiKey,
          model: settings?.geminiModel,
        }),
        parseWebsiteUpdateMessageWithGemini({
          text: message.text,
          apiKey: settings?.geminiApiKey,
          model: settings?.geminiModel,
        }),
      ]);

      const recordDate = parsedExpiry.createdAt || parsedUpdate.createdAt || receivedAtMyanmar;
      await queueStructuredSubmission({
        fileName: `Project & Service text entry — ${recordDate.toISOString().slice(0, 10)}`,
        fileType: 'text/plain',
        kind: 'project_service_tracking',
        payload: {
          projects: [{
            projectName: parsedExpiry.projectName,
            url: parsedExpiry.url,
            packageName: parsedExpiry.packageName,
            domainProvider: parsedExpiry.domainProvider,
            hostingProvider: parsedExpiry.hostingProvider,
            hostingRemark: parsedExpiry.hostingRemark,
            domainExpireDate: parsedExpiry.domainExpireDate,
            hostingExpireDate: parsedExpiry.hostingExpireDate,
            offerExpireDate: parsedExpiry.offerExpireDate || null,
            projectStatus: parsedExpiry.projectStatus || 'active',
            remark: parsedExpiry.remark,
            createdAt: recordDate,
          }],
          websites: [{
            name: parsedUpdate.name,
            url: parsedUpdate.url,
            businessType: parsedUpdate.businessType,
            packageName: parsedUpdate.packageName,
            status: parsedUpdate.status || 'pending_update',
            remark: parsedUpdate.remark,
            createdAt: recordDate,
          }],
        },
        rowCount: 1,
        senderId: sender.id,
        messageId: telegramMessage.id,
        sourceTelegramMessageId: String(message.message_id),
        chatId,
        progressMsgId: null,
        botToken: settings?.botToken,
      });

      return NextResponse.json({ ok: true });
    }

    // ─── Project Expiry Mode ───────────────────────────────────────────
    if (activeMode === 'project_expiry') {
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

      const parsedExpiry = await parseProjectExpiryMessageWithGemini({
        text: message.text,
        apiKey: settings?.geminiApiKey,
        model: settings?.geminiModel,
      });

      const recordDate = parsedExpiry.createdAt || receivedAtMyanmar;
      await queueStructuredSubmission({
        fileName: `Project expiry text entry — ${recordDate.toISOString().slice(0, 10)}`,
        fileType: 'text/plain', kind: 'project_service_tracking',
        payload: { projects: [{ ...parsedExpiry, createdAt: recordDate }], websites: [] }, rowCount: 1,
        senderId: sender.id, messageId: telegramMessage.id,
        sourceTelegramMessageId: String(message.message_id), chatId, progressMsgId: null, botToken: settings?.botToken,
      });

      return NextResponse.json({ ok: true });
    }

    // ─── Website Update Mode ───────────────────────────────────────────
    if (activeMode === 'website_update') {
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

      const parsedUpdate = await parseWebsiteUpdateMessageWithGemini({
        text: message.text,
        apiKey: settings?.geminiApiKey,
        model: settings?.geminiModel,
      });

      const recordDate = parsedUpdate.createdAt || receivedAtMyanmar;
      await queueStructuredSubmission({
        fileName: `Website update text entry — ${recordDate.toISOString().slice(0, 10)}`,
        fileType: 'text/plain', kind: 'project_service_tracking',
        payload: { projects: [], websites: [{ ...parsedUpdate, createdAt: recordDate }] }, rowCount: 1,
        senderId: sender.id, messageId: telegramMessage.id,
        sourceTelegramMessageId: String(message.message_id), chatId, progressMsgId: null, botToken: settings?.botToken,
      });

      return NextResponse.json({ ok: true });
    }

    // ─── Finance Transactions Mode (text) ─────────────────────────────
    if (activeMode === 'finance_transactions') {
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

      // Finance text has a different template from KPI/business reports.
      // Parse its labelled finance fields directly so it produces one record.
      const financeRecord = parseFinanceTransactionText(message.text, receivedAtMyanmar);
      const financeRecords = financeRecord ? [financeRecord] : [];
      if (!financeRecord) {
        await sendTelegramMessage({
          botToken: settings.botToken,
          chatId,
          text: '⚠️ <b>Finance record ကိုဖတ်မရပါ</b>\n\nType ကို <code>Income</code> သို့မဟုတ် <code>Expense</code> ဟုထည့်ပြီး Amount (MMK) တွင် 0 ထက်ကြီးသော ငွေပမာဏ ထည့်ပေးပါ။',
        });
        return NextResponse.json({ ok: true });
      }
      await queueStructuredSubmission({
        fileName: `Finance text entry — ${financeRecord.date.toISOString().slice(0, 10)}`,
        fileType: 'text/plain',
        kind: 'finance_transactions',
        payload: { records: financeRecords },
        rowCount: financeRecords.length,
        senderId: sender.id,
        messageId: telegramMessage.id,
        sourceTelegramMessageId: String(message.message_id),
        chatId,
        progressMsgId: null,
        botToken: settings.botToken,
      });

      return NextResponse.json({ ok: true });
    }

    // ─── Business Report Mode (text) ──────────────────────────────────
    if (activeMode === 'business_report') {
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

      const parsed = await parseBusinessReportWithGemini({
        text: message.text,
        apiKey: settings?.geminiApiKey,
        model: settings?.geminiModel,
        fallbackDate: receivedAtMyanmar,
      });

      await queueStructuredSubmission({
        fileName: `Business KPI text entry — ${parsed.reportDate.toISOString().slice(0, 10)}`,
        fileType: 'text/plain', kind: 'business_report',
        payload: { records: [{ ...parsed, reporterName: parsed.reporterName || sender.displayName }] }, rowCount: 1,
        senderId: sender.id, messageId: telegramMessage.id,
        sourceTelegramMessageId: String(message.message_id), chatId, progressMsgId: null, botToken: settings?.botToken,
      });

      return NextResponse.json({ ok: true });
    }

    // ─── Demand Report Mode ───────────────────────────────────────────
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
      receivedAt: receivedAtMyanmar,
      apiKey: settings?.geminiApiKey,
      model: settings?.geminiModel,
    });

    // Sales and Customer Service text uses exactly the same pending-import
    // model as uploaded files. Nothing reaches the customer records until the
    // sender confirms and an independent approver approves it.
    const reportType = activeMode === 'customer_service' ? 'customer_service' : 'demand_report';
    const pendingImport = await prisma.pendingDemandImport.create({
      data: {
        senderId: sender.id,
        messageId: telegramMessage.id,
        chatId,
        previewMessageId: null,
        fileName: `${activeMode === 'customer_service' ? 'Customer Service' : 'Sales & Marketing'} text entry — ${(parsedDemand.createdAt || receivedAtMyanmar).toISOString().slice(0, 10)}`,
        fileType: 'text/plain',
        extractedText: message.text.slice(0, 10000),
        parsedRows: [serializeParsedDemand(parsedDemand)],
        summary: { ...summarizeParsedDemands([parsedDemand]), sourceTelegramMessageId: String(message.message_id) },
        errors: [],
        reportType,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const replyMarkup = {
      inline_keyboard: [[
        { text: '✅ Confirm Import', callback_data: `demand_import_confirm:${pendingImport.id}` },
        { text: '❌ Cancel', callback_data: `demand_import_cancel:${pendingImport.id}` },
      ]],
    };
    const preview = await sendTelegramMessage({
      botToken: settings?.botToken,
      chatId,
      text: buildDemandImportPreviewText({
        fileName: pendingImport.fileName,
        parsedDemands: [parsedDemand],
        errors: [],
        activeMode,
      }),
      replyMarkup,
    });
    if (preview) {
      await prisma.pendingDemandImport.update({
        where: { id: pendingImport.id },
        data: { previewMessageId: preview.message_id },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    return NextResponse.json({ ok: true });
  }
}
