import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import * as XLSX from "xlsx";
import {
  parseDemandMessageWithGemini,
  answerQuestionWithGemini,
  extractDataFromFile,
  isFileTooLarge,
  isProjectExpiryHeaders,
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
} from "@/lib/demand-parser";
import { analyzeDemandRecord } from "@/lib/demand-analysis";
import { NextRequest, NextResponse, after } from "next/server";
import { sendOTPEmail } from "@/lib/email";
import { formatPhoneNumber } from "@/lib/utils";

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
}) {
  const displayName = displayNameFromTelegramUser(from);
  
  // Find active bot owner to link to this sender
  const settings = await prisma.botSettings.findFirst({
    where: { isActive: true },
    select: { userId: true },
  });
  const ownerUserId = settings?.userId || null;

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
      activeReportType: 'none',
      userId: ownerUserId,
    },
    update: {
      firstName: from.first_name || undefined,
      lastName: from.last_name || null,
      username: from.username || null,
      displayName: displayName || undefined,
      ...(ownerUserId ? { userId: ownerUserId } : {}),
    },
  });
}

const MAIN_MENU_BUTTONS = {
  inline_keyboard: [
    [{ text: "🤖 Q&A မေးမြန်း", callback_data: "mode:qa" }, { text: "📈 Sales & Marketing", callback_data: "mode:demand_report" }],
    [{ text: "⏰ Project Expiry", callback_data: "mode:project_expiry" }, { text: "🔧 Website Update", callback_data: "mode:website_update" }],
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
    [{ text: "/menu" }],
    [{ text: "/format" }, { text: "/template" }],
    [{ text: "/unlink" }]
  ],
  resize_keyboard: true,
  one_time_keyboard: false
};

const FORMAT_INLINE_BUTTONS = {
  inline_keyboard: [
    [
      { text: "📋 Template ကူးယူရန်", callback_data: "action:template" },
      { text: "↩️ Main Menu", callback_data: "action:menu" }
    ]
  ]
};

function buildMainMenuButtons(allowedDepartments: string[]) {
  const buttons: { text: string; callback_data: string }[][] = [];
  const row1: { text: string; callback_data: string }[] = [];
  const row2: { text: string; callback_data: string }[] = [];
  const row3: { text: string; callback_data: string }[] = [];

  if (allowedDepartments.includes('QA')) {
    row1.push({ text: "🤖 Q&A မေးမြန်း", callback_data: "mode:qa" });
  }
  if (allowedDepartments.includes('Sales')) {
    row1.push({ text: "📈 Sales & Marketing", callback_data: "mode:demand_report" });
  }
  if (allowedDepartments.includes('IT')) {
    row2.push({ text: "⏰ Project Expiry", callback_data: "mode:project_expiry" });
    row2.push({ text: "🔧 Website Update", callback_data: "mode:website_update" });
  }
  if (allowedDepartments.includes('Finance')) {
    row3.push({ text: "📊 Business KPI Report", callback_data: "mode:business_report" });
  }

  if (row1.length) buttons.push(row1);
  if (row2.length) buttons.push(row2);
  if (row3.length) buttons.push(row3);

  return { inline_keyboard: buttons };
}

function getDepartmentForMode(mode: string): string | null {
  if (mode === 'demand_report') return 'Sales';
  if (mode === 'project_expiry' || mode === 'website_update') return 'IT';
  if (mode === 'business_report') return 'Finance';
  if (mode === 'qa') return 'QA';
  return null;
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
  sender: any,
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
    "  <i>June sample file columns နှင့် ကိုက်ညီသော အရောင်း/စျေးကွက်မှတ်တမ်း</i>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    "",
    "📄 စာသား <b>သို့မဟုတ်</b> Excel/CSV",
    "    ဖိုင်ကို တိုက်ရိုက်ပို့နိုင်ပါသည်",
    "",
    "📝 <b>စာသားပုံစံ:</b>",
    "<pre>",
    "• Date: [YYYY-MM-DD]",
    "• Customer Name: [နာမည်]",
    "• Phone: [ဖုန်းနံပါတ်]",
    "• Company: [ကုမ္ပဏီအမည်]",
    "• Service Name: [ဝန်ဆောင်မှု]",
    "• Service Amount: [ငွေ]",
    "• Service Qty: [အရေအတွက်]",
    "• Follow-up Date: [YYYY-MM-DD]",
    "• Note: [မှတ်ချက်]",
    "</pre>",
    "",
    "💡 <i>မလိုအပ်သော စာကြောင်းများ ချန်လှပ်ထားနိုင်ပါသည်</i>",
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
    "📝 <b>စာသားပုံစံ:</b>",
    "<pre>",
    "• Date: [YYYY-MM-DD]",
    "• Reporter: [အမည်]",
    "• Marketing Budget: [Ks]",
    "• Marketing Channel: [FB / Google / Referral]",
    "• Calls Made: [ဦးရေ]",
    "• Appointments Made: [ဦးရေ]",
    "• Appointments Kept: [ဦးရေ]",
    "• New Leads: [ဦးရေ]",
    "• Total Sales Amount: [Ks]",
    "• Closed Deals: [ဦးရေ]",
    "• Pending Deals: [ဦးရေ]",
    "• Notes: [မှတ်ချက်]",
    "</pre>",
    "",
    "━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

// Return the full format guide for whatever report mode the sender is in.
function getFormatPromptForMode(mode: string | null | undefined): string {
  switch (mode) {
    case 'project_expiry':
      return getProjectExpiryFormatPrompt();
    case 'website_update':
      return getWebsiteUpdateFormatPrompt();
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
  } else if (mode === 'project_expiry') {
    fields = "Date • Check List • URL • Package • Domain/Hosting • Remark";
  } else if (mode === 'website_update') {
    fields = "Date • Project Name • Website Link • Business Type • Package Name • Status • Remark";
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


function parseFinanceRecordsSpreadsheet(fileBuffer: Buffer): any[] {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellDates: true });
  const allRecords: any[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: true });
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
      });
    }
  }
  return allRecords;
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


async function buildQAContext(): Promise<string> {
  const [demandRecords, qaDocs, customers, projectExpiries, websiteUpdates, businessReports] = await Promise.all([
    prisma.demandRecord.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { sender: true },
    }),
    prisma.qADocument.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    prisma.customer.findMany({
      take: 20,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.projectExpiration.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.websiteUpdate.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.businessReport.findMany({
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
        `Reporter: ${r.sender.displayName}`,
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
  }[],
  senderId: string,
  fileName: string,
): Promise<Map<string, string>> {
  const nameToNormalized = new Map<string, string>();
  const nameToDetails = new Map<string, { phone: string | null; company: string | null }>();

  for (const d of parsedDemands) {
    if (d.customerName) {
      const normalized = normalizeCustomerName(d.customerName);
      if (!nameToNormalized.has(d.customerName)) {
        nameToNormalized.set(d.customerName, normalized);
      }

      const existing = nameToDetails.get(d.customerName);
      const existingDate = existing ? (existing as any).createdAt : null;
      const newDate = (d as any).createdAt || null;
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
      } as any);
    }
  }
  if (nameToNormalized.size === 0) return new Map();

  const allNormalized = Array.from(new Set(nameToNormalized.values()));
  const allRawNames = Array.from(nameToNormalized.keys());

  const [byNormalizedRows, byRawNameRows] = await Promise.all([
    prisma.customer.findMany({
      where: { nameNormalized: { in: allNormalized } },
      select: { id: true, name: true, nameNormalized: true },
    }),
    prisma.customer.findMany({
      where: { name: { in: allRawNames } },
      select: { id: true, name: true, nameNormalized: true },
    }),
  ]);

  const idByNormalized = new Map<string, { id: string; name: string; nameNormalized: string | null }>();
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
          nameNormalized: m.normalized,
          phone: details?.phone || null,
          company: details?.company || null,
          createdAt: (details as any)?.createdAt || undefined,
        },
        select: { id: true, name: true, nameNormalized: true },
      });
      idByNormalized.set(m.normalized, created);
    } catch (err) {
      if (isPrismaUniqueConstraintError(err)) {
        const existing = await prisma.customer.findFirst({
          where: { nameNormalized: m.normalized },
          select: { id: true, name: true, nameNormalized: true },
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
      const updateData: { phone?: string; company?: string; nameNormalized?: string; updatedAt?: Date } = {};
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
      createdAt: (details as any)?.createdAt || undefined,
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
}: {
  fileName: string;
  parsedDemands: ParsedDemandRecord[];
  errors: string[];
}) {
  const summary = summarizeParsedDemands(parsedDemands);
  const parts = [
    "📄 <b>Sales & Marketing file preview</b>",
    "━━━━━━━━━━━━━━━━━━━━",
    `📎 <b>File:</b> <code>${escapeHtml(fileName)}</code>`,
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
    "ဒီ preview မှန်တယ်ဆိုရင် <b>Confirm Import</b> ကိုနှိပ်ပါ။ မမှန်ရင် <b>Cancel</b> နှိပ်ပြီး file/header ကိုပြန်စစ်ပါ။",
  );

  return parts.join("\n");
}

async function createDemandRecordsFromParsedDemands({
  parsedDemands,
  senderId,
  telegramMessageId,
  fileName,
  sourceType = 'telegram',
  importBatchId,
}: {
  parsedDemands: ParsedDemandRecord[];
  senderId: string;
  telegramMessageId: string;
  fileName?: string | null;
  sourceType?: string;
  importBatchId?: string | null;
}) {
  const customerIdByName = await resolveCustomersBatch(
    parsedDemands,
    senderId,
    fileName || 'Telegram demand import',
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
  progressMsgId,
  receivedAtMyanmar,
}: {
  downloadedBuffer: Buffer;
  fileInfo: { fileName: string; mimeType: string; fileSize: number };
  caption?: string;
  settings: { botToken: string | null; geminiApiKey: string | null; geminiModel: string | null };
  chatId: bigint;
  senderId: string;
  telegramMessageId: string;
  progressMsgId: number | null;
  receivedAtMyanmar: Date;
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
    let parsedExpiryRecords: any[] = [];
    let isWebsiteUpdateFile = false;
    let parsedWebsiteUpdateRecords: any[] = [];
    let isBusinessReportFile = false;
    let parsedBusinessReportRecords: any[] = [];
    let isFinanceFile = false;
    let parsedFinanceRecords: any[] = [];

    if (isSpreadsheet) {
      try {
        const workbook = XLSX.read(downloadedBuffer, { type: 'buffer', cellDates: true });
        if (workbook.SheetNames.length > 0) {
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, { header: 1 });
          if (rows.length > 0 && Array.isArray(rows[0])) {
            const headers = rows[0].map(h => String(h || ''));
            if (isProjectExpiryHeaders(headers)) {
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

    if (isExpiryFile) {
      const creates = parsedExpiryRecords.map(rec => ({
        projectName: rec.projectName,
        url: rec.url,
        packageName: rec.packageName,
        domainProvider: rec.domainProvider,
        hostingProvider: rec.hostingProvider,
        hostingRemark: rec.hostingRemark,
        domainExpireDate: rec.domainExpireDate,
        hostingExpireDate: rec.hostingExpireDate,
        remark: rec.remark,
        createdAt: rec.createdAt || receivedAtMyanmar,
      }));

      if (creates.length > 0) {
        await prisma.projectExpiration.createMany({
          data: creates,
        });
      }

      if (progressMsgId) {
        await editTelegramMessage({
          botToken: settings.botToken,
          chatId,
          messageId: progressMsgId,
          text: [
            "✅ <b>ဝဘ်ဆိုဒ် သက်တမ်းကုန်ဆုံးမှု စာရင်းသွင်းပြီးပါပြီ</b>",
            "━━━━━━━━━━━━━━━━━━━━",
            `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
            `📊 <b>အရေအတွက်:</b> <code>${creates.length}</code> ပရောဂျက်များကို အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။`,
          ].join("\n"),
        });
      }
      return;
    }

    if (isWebsiteUpdateFile) {
      const creates = parsedWebsiteUpdateRecords.map(rec => ({
        name: rec.name,
        url: rec.url,
        businessType: rec.businessType,
        packageName: rec.packageName,
        status: rec.status || "pending_update",
        remark: rec.remark,
        createdAt: rec.createdAt || receivedAtMyanmar,
      }));

      if (creates.length > 0) {
        await prisma.websiteUpdate.createMany({
          data: creates,
        });
      }

      if (progressMsgId) {
        await editTelegramMessage({
          botToken: settings.botToken,
          chatId,
          messageId: progressMsgId,
          text: [
            "✅ <b>ဝဘ်ဆိုဒ် အပ်ဒိတ်စောင့်ကြည့်မှု စာရင်းသွင်းပြီးပါပြီ</b>",
            "━━━━━━━━━━━━━━━━━━━━",
            `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
            `📊 <b>အရေအတွက်:</b> <code>${creates.length}</code> ခုကို အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။`,
          ].join("\n"),
        });
      }
      return;
    }

    if (isBusinessReportFile) {
      const creates = parsedBusinessReportRecords.map((rec: any) => ({
        reportDate: rec.reportDate || receivedAtMyanmar,
        reporterName: rec.reporterName || null,
        senderId: senderId,
        messageId: telegramMessageId,
        marketingBudget: rec.marketingBudget,
        marketingChannel: rec.marketingChannel,
        callsMade: rec.callsMade,
        appointmentsMade: rec.appointmentsMade,
        appointmentsKept: rec.appointmentsKept,
        newLeads: rec.newLeads,
        totalDemandCount: rec.totalDemandCount,
        totalSalesAmount: rec.totalSalesAmount,
        closedDeals: rec.closedDeals,
        pendingDeals: rec.pendingDeals,
        notes: rec.notes,
      }));

      if (creates.length > 0) {
        await prisma.businessReport.createMany({ data: creates });
      }

      if (progressMsgId) {
        await editTelegramMessage({
          botToken: settings.botToken,
          chatId,
          messageId: progressMsgId,
          text: [
            "✅ <b>လုပ်ငန်းလှုပ်ရှားမှု မှတ်တမ်းများ တင်သွင်းပြီးပါပြီ</b>",
            "━━━━━━━━━━━━━━━━━━━━",
            `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
            `📊 <b>အရေအတွက်:</b> <code>${creates.length}</code> ရက်/မှတ်တမ်းများကို အောင်မြင်စွာ သိမ်းဆည်းပြီးပါပြီ။`,
          ].join("\n"),
        });
      }
      return;
    }

    if (isFinanceFile) {
      const creates = parsedFinanceRecords.map((rec: any) => {
        const isIncome = rec.type.toLowerCase() === 'income';
        const recordDate = rec.date || receivedAtMyanmar;
        return {
          reportDate: recordDate,
          senderId: senderId,
          messageId: telegramMessageId,
          marketingBudget: isIncome ? 0 : rec.amount,
          marketingChannel: rec.category || "Service",
          notes: `${rec.description} (Ref: ${rec.reference}, Method: ${rec.paymentMethod}). ${rec.notes || ""}`,
          totalSalesAmount: isIncome ? rec.amount : 0,
          newLeads: isIncome ? 0 : (rec.category === "Marketing" ? 1 : 0),
          closedDeals: isIncome ? 1 : 0,
          totalDemandCount: 1,
          reporterName: "Telegram Upload",
          createdAt: recordDate,
        };
      });

      if (creates.length > 0) {
        await prisma.businessReport.createMany({ data: creates });
      }

      if (progressMsgId) {
        await editTelegramMessage({
          botToken: settings.botToken,
          chatId,
          messageId: progressMsgId,
          text: [
            "✅ <b>ဘဏ္ဍာရေး ငွေသွင်း/ငွေထုတ် မှတ်တမ်းများ တင်သွင်းပြီးပါပြီ</b>",
            "━━━━━━━━━━━━━━━━━━━━",
            `📄 <b>ဖိုင်အမည်:</b> <code>${fileInfo.fileName}</code>`,
            `📊 <b>အရေအတွက်:</b> <code>${creates.length}</code> စောင်ကို အောင်မြင်စွာ မှတ်တမ်းတင်ပြီးပါပြီ။`,
          ].join("\n"),
        });
      }
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
        summary,
        errors,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    const previewText = buildDemandImportPreviewText({
      fileName: fileInfo.fileName,
      parsedDemands,
      errors,
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

      // ─── Guard: Check Authorization ─────────────────────────────────
      const isAuthorized = await checkAuthorization(sender, settings?.botToken, chatId ? BigInt(chatId) : 0);
      if (!isAuthorized) {
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Unauthorized');
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
          if (chatId && messageId) {
            await editTelegramMessage({
              botToken: settings?.botToken,
              chatId: BigInt(chatId),
              messageId,
              text: [
                "⌛ <b>Sales & Marketing file preview expired</b>",
                "━━━━━━━━━━━━━━━━━━━━",
                `📎 <b>File:</b> <code>${escapeHtml(pending.fileName)}</code>`,
                "ကျေးဇူးပြု၍ file ကိုပြန်ပို့ပြီး preview အသစ်လုပ်ပါ။",
              ].join("\n"),
            });
          }
          return NextResponse.json({ ok: true });
        }

        const rows = Array.isArray(pending.parsedRows)
          ? pending.parsedRows.map((row) => hydrateParsedDemand(row as Record<string, unknown>))
          : [];

        if (rows.length === 0) {
          await prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'cancelled' },
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
          },
        });

        await prisma.qADocument.create({
          data: {
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
          importBatchId: importBatch.id,
        });

        await Promise.all([
          prisma.demandImportBatch.update({
            where: { id: importBatch.id },
            data: { importedCount },
          }),
          prisma.pendingDemandImport.update({
            where: { id: pending.id },
            data: { status: 'confirmed' },
          }),
        ]);

        const summary = summarizeParsedDemands(rows);
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, `Imported ${importedCount} records`);
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              "✅ <b>Sales & Marketing file imported</b>",
              "━━━━━━━━━━━━━━━━━━━━",
              `📎 <b>File:</b> <code>${escapeHtml(pending.fileName)}</code>`,
              `📊 <b>Imported:</b> <code>${importedCount}</code> records`,
              "",
              "🎯 <b>Priority summary</b>",
              `• High: <b>${summary.high}</b>`,
              `• Medium: <b>${summary.medium}</b>`,
              `• Low: <b>${summary.low}</b>`,
              "",
              "Dashboard မှာ Sales & Marketing records ကိုကြည့်ပြီး priority/action တွေကို ဆက်လုပ်နိုင်ပါပြီ။",
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
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: [
              "❌ <b>Sales & Marketing file import cancelled</b>",
              "━━━━━━━━━━━━━━━━━━━━",
              `📎 <b>File:</b> <code>${escapeHtml(pending.fileName)}</code>`,
              "Dashboard ထဲသို့ data မသွင်းထားပါ။ File ကိုပြင်ပြီးပြန်ပို့နိုင်ပါသည်။",
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
            replyMarkup: FORMAT_INLINE_BUTTONS,
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:project_expiry') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'project_expiry' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Project Expiry selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getProjectExpiryFormatPrompt(),
            replyMarkup: FORMAT_INLINE_BUTTONS,
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:website_update') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'website_update' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, '✅ Website Update selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getWebsiteUpdateFormatPrompt(),
            replyMarkup: FORMAT_INLINE_BUTTONS,
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
            replyMarkup: FORMAT_INLINE_BUTTONS,
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

    const sender = await upsertSender(from);
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
              `ဤအီးမေးလ် <code>${email}</code> ကို Staff Bot Access တွင်`,
              "Business Owner မှ ကြိုတင်ထည့်သွင်းထားခြင်း မရှိပါ။",
              "",
              "💡 <i>ကျေးဇူးပြု၍ သင့်လုပ်ငန်းတာဝန်ရှိသူအား</i>",
              "<i>Staff Bot Access တွင် စာရင်းသွင်းပေးရန် ပြောပါ။</i>",
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
            // Delete the temporary record to free the unique telegramUserId constraint
            await prisma.telegramSender.delete({
              where: { id: sender.id },
            });

            // Update the pre-registered record with the telegram user details!
            await prisma.telegramSender.update({
              where: { id: preRegistered.id },
              data: {
                telegramUserId: sender.telegramUserId,
                firstName: from.first_name || "Unknown",
                lastName: from.last_name || null,
                username: from.username || null,
                displayName: displayName || "Unknown",
                isVerified: true,
                isAuthorized: true, // Pre-authorized by business owner!
                activeReportType: 'none',
                otpCode: null,
                otpExpiresAt: null,
              },
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

    if (message.text === '/format') {
      const showButtons = ['project_expiry', 'website_update', 'business_report', 'demand_report'].includes(sender.activeReportType);
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: getFormatPromptForMode(sender.activeReportType),
        ...(showButtons ? { replyMarkup: FORMAT_INLINE_BUTTONS } : {}),
      });
      return NextResponse.json({ ok: true });
    }

    if (message.text === '/template') {
      const showButtons = ['project_expiry', 'website_update', 'business_report', 'demand_report'].includes(sender.activeReportType);
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: getCopyPasteTemplateForMode(sender.activeReportType),
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

      const activeMode = updatedSender.activeReportType;

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
            telegramMessageId: telegramMessage.id,
            progressMsgId,
            receivedAtMyanmar,
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
    const activeMode = isBusinessReport ? 'business_report' : updatedSender.activeReportType;

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

      await prisma.projectExpiration.create({
        data: {
          projectName: parsedExpiry.projectName,
          url: parsedExpiry.url,
          packageName: parsedExpiry.packageName,
          domainProvider: parsedExpiry.domainProvider,
          hostingProvider: parsedExpiry.hostingProvider,
          hostingRemark: parsedExpiry.hostingRemark,
          domainExpireDate: parsedExpiry.domainExpireDate,
          hostingExpireDate: parsedExpiry.hostingExpireDate,
          remark: parsedExpiry.remark,
          createdAt: parsedExpiry.createdAt || receivedAtMyanmar || undefined,
        },
      });

      const recordDate = parsedExpiry.createdAt || receivedAtMyanmar;
      const confirmParts = [
        "✅ <b>သက်တမ်းကုန်ဆုံးမှုမှတ်တမ်း တင်သွင်းခြင်း အောင်မြင်ပါသည်</b>",
        "━━━━━━━━━━━━━━━━━━━━",
        `📅 <b>ရက်စွဲ:</b> <code>${recordDate.toISOString().slice(0, 10)}</code>`,
        `📁 <b>ပရောဂျက်:</b> <code>${parsedExpiry.projectName}</code>`,
      ];
      if (parsedExpiry.url) confirmParts.push(`🌐 <b>URL:</b> <code>${parsedExpiry.url}</code>`);
      if (parsedExpiry.packageName) confirmParts.push(`📦 <b>Package:</b> <code>${parsedExpiry.packageName}</code>`);
      if (parsedExpiry.domainExpireDate) confirmParts.push(`📅 <b>Domain Expiry:</b> <code>${parsedExpiry.domainExpireDate.toISOString().slice(0, 10)}</code>`);
      if (parsedExpiry.hostingExpireDate) confirmParts.push(`📅 <b>Hosting Expiry:</b> <code>${parsedExpiry.hostingExpireDate.toISOString().slice(0, 10)}</code>`);
      if (parsedExpiry.remark) confirmParts.push(`📝 <b>မှတ်ချက်:</b> <i>${parsedExpiry.remark}</i>`);
      confirmParts.push(getFormatHintFooter('project_expiry'));

      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: confirmParts.join('\n'),
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

      await prisma.websiteUpdate.create({
        data: {
          name: parsedUpdate.name,
          url: parsedUpdate.url,
          businessType: parsedUpdate.businessType,
          packageName: parsedUpdate.packageName,
          status: parsedUpdate.status,
          remark: parsedUpdate.remark,
          createdAt: parsedUpdate.createdAt || receivedAtMyanmar || undefined,
        },
      });

      const recordDate = parsedUpdate.createdAt || receivedAtMyanmar;
      const confirmParts = [
        "✅ <b>ဝဘ်ဆိုဒ် အပ်ဒိတ်/ထိန်းသိမ်းမှု မှတ်တမ်း တင်သွင်းခြင်း အောင်မြင်ပါသည်</b>",
        "━━━━━━━━━━━━━━━━━━━━",
        `📅 <b>ရက်စွဲ:</b> <code>${recordDate.toISOString().slice(0, 10)}</code>`,
        `📁 <b>အမည်:</b> <code>${parsedUpdate.name}</code>`,
      ];
      if (parsedUpdate.url) confirmParts.push(`🌐 <b>URL:</b> <code>${parsedUpdate.url}</code>`);
      if (parsedUpdate.businessType) confirmParts.push(`🏢 <b>လုပ်ငန်း:</b> <code>${parsedUpdate.businessType}</code>`);
      if (parsedUpdate.packageName) confirmParts.push(`📦 <b>Package:</b> <code>${parsedUpdate.packageName}</code>`);
      if (parsedUpdate.status) confirmParts.push(`⚙️ <b>အခြေအနေ:</b> <code>${parsedUpdate.status}</code>`);
      if (parsedUpdate.remark) confirmParts.push(`📝 <b>မှတ်ချက်:</b> <i>${parsedUpdate.remark}</i>`);
      confirmParts.push(getFormatHintFooter('website_update'));

      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: confirmParts.join('\n'),
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

      await prisma.businessReport.create({
        data: {
          reportDate: parsed.reportDate,
          reporterName: parsed.reporterName || sender.displayName,
          senderId: sender.id,
          messageId: telegramMessage.id,
          marketingBudget: parsed.marketingBudget,
          marketingChannel: parsed.marketingChannel,
          callsMade: parsed.callsMade,
          appointmentsMade: parsed.appointmentsMade,
          appointmentsKept: parsed.appointmentsKept,
          newLeads: parsed.newLeads,
          totalDemandCount: parsed.totalDemandCount,
          totalSalesAmount: parsed.totalSalesAmount,
          closedDeals: parsed.closedDeals,
          pendingDeals: parsed.pendingDeals,
          notes: parsed.notes,
          targetDemandCount: parsed.targetDemandCount,
          targetAppointments: parsed.targetAppointments,
          targetSalesAmount: parsed.targetSalesAmount,
        },
      });

      const confirmParts = [
        "✅ <b>လုပ်ငန်းလှုပ်ရှားမှု မှတ်တမ်း တင်သွင်းခြင်း အောင်မြင်ပါသည်</b>",
        "━━━━━━━━━━━━━━━━━━━━",
        `📅 <b>ရက်စွဲ:</b> <code>${parsed.reportDate.toISOString().slice(0, 10)}</code>`,
      ];

      // If customer info is in the business report text, also create a Customer & DemandRecord
      const parsedDemand = await parseDemandMessageWithGemini({
        text: message.text,
        receivedAt: receivedAtMyanmar,
        apiKey: settings?.geminiApiKey,
        model: settings?.geminiModel,
      });

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
              ...(parsedDemand.customerPhone ? { phone: formatPhoneNumber(parsedDemand.customerPhone) } : {}),
              ...(parsedDemand.customerCompany ? { company: parsedDemand.customerCompany } : {}),
            },
          });
        } else {
          customer = await prisma.customer.create({
            data: {
              name: parsedDemand.customerName,
              nameNormalized: normalizedName,
              phone: parsedDemand.customerPhone ? formatPhoneNumber(parsedDemand.customerPhone) : null,
              company: parsedDemand.customerCompany || null,
              createdAt: parsedDemand.createdAt || receivedAtMyanmar || undefined,
            },
          });
        }
        const customerId = customer.id;

        await prisma.customerActivity.create({
          data: {
            customerId: customer.id,
            senderId: sender.id,
            action: 'demand_report',
            description: parsedDemand.note,
            createdAt: parsedDemand.createdAt || receivedAtMyanmar || undefined,
          },
        });

        const analysis = analyzeDemandRecord(parsedDemand);

        await prisma.demandRecord.create({
          data: {
            messageId: telegramMessage.id,
            senderId: sender.id,
            customerId,
            customerName: parsedDemand.customerName,
            category: parsedDemand.category,
            status: parsedDemand.status || 'closed',
            note: parsedDemand.note,
            sourceChannel: parsedDemand.sourceChannel || 'Telegram',
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
            createdAt: parsedDemand.createdAt || receivedAtMyanmar || undefined,
          },
        });

        confirmParts.push("");
        confirmParts.push(`👤 <b>ဝယ်ယူသူ စာရင်းသွင်းမှု အလိုအလျောက် အောင်မြင်ပါသည်:</b>`);
        confirmParts.push(`• Customer: <code>${parsedDemand.customerName}</code>`);
        if (parsedDemand.serviceName) confirmParts.push(`• Service: <code>${parsedDemand.serviceName}</code>`);
      }
      if (parsed.marketingChannel) confirmParts.push(`📢 <b>Channel:</b> <code>${parsed.marketingChannel}</code>`);
      if (parsed.marketingBudget != null) confirmParts.push(`💸 <b>Budget:</b> <code>${parsed.marketingBudget.toLocaleString()} Ks</code>`);
      if (parsed.callsMade != null) confirmParts.push(`📞 <b>Calls:</b> <code>${parsed.callsMade}</code>`);
      if (parsed.appointmentsMade != null) confirmParts.push(`🗓️ <b>Appts Made:</b> <code>${parsed.appointmentsMade}</code>`);
      if (parsed.appointmentsKept != null) confirmParts.push(`✅ <b>Appts Kept:</b> <code>${parsed.appointmentsKept}</code>`);
      if (parsed.newLeads != null) confirmParts.push(`👥 <b>New Leads:</b> <code>${parsed.newLeads}</code>`);
      if (parsed.totalSalesAmount != null) confirmParts.push(`💰 <b>Total Sales:</b> <code>${parsed.totalSalesAmount.toLocaleString()} Ks</code>`);
      if (parsed.closedDeals != null) confirmParts.push(`🎯 <b>Closed:</b> <code>${parsed.closedDeals}</code>`);
      if (parsed.pendingDeals != null) confirmParts.push(`⏳ <b>Pending:</b> <code>${parsed.pendingDeals}</code>`);
      
      if (parsed.targetDemandCount != null || parsed.targetAppointments != null || parsed.targetSalesAmount != null) {
        confirmParts.push("");
        confirmParts.push("🎯 <b>Monthly Targets</b>");
        if (parsed.targetDemandCount != null) confirmParts.push(`• Messages: <b>${parsed.targetDemandCount}</b>`);
        if (parsed.targetAppointments != null) confirmParts.push(`• Appts: <b>${parsed.targetAppointments}</b>`);
        if (parsed.targetSalesAmount != null) confirmParts.push(`• Sales: <b>${parsed.targetSalesAmount.toLocaleString()} Ks</b>`);
      }

      if (parsed.notes) confirmParts.push(`📝 <b>Notes:</b> <i>${parsed.notes}</i>`);
      confirmParts.push(getFormatHintFooter('business_report'));

      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: confirmParts.join('\n'),
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
            ...(parsedDemand.customerPhone ? { phone: formatPhoneNumber(parsedDemand.customerPhone) } : {}),
            ...(parsedDemand.customerCompany ? { company: parsedDemand.customerCompany } : {}),
          },
        });
      } else {
        customer = await prisma.customer.create({
          data: {
            name: parsedDemand.customerName,
            nameNormalized: normalizedName,
            phone: parsedDemand.customerPhone ? formatPhoneNumber(parsedDemand.customerPhone) : null,
            company: parsedDemand.customerCompany || null,
            createdAt: parsedDemand.createdAt || receivedAtMyanmar || undefined,
          },
        });
      }
      customerId = customer.id;

      await prisma.customerActivity.create({
        data: {
          customerId: customer.id,
          senderId: sender.id,
          action: 'demand_report',
          description: parsedDemand.note,
          createdAt: parsedDemand.createdAt || receivedAtMyanmar || undefined,
        },
      });
    }

    const analysis = analyzeDemandRecord(parsedDemand);

    await prisma.demandRecord.create({
      data: {
        messageId: telegramMessage.id,
        senderId: sender.id,
        customerId,
        customerName: parsedDemand.customerName,
        category: parsedDemand.category,
        status: parsedDemand.status,
        note: parsedDemand.note,
        sourceChannel: parsedDemand.sourceChannel || 'Telegram',
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
        createdAt: parsedDemand.createdAt || receivedAtMyanmar || undefined,
      },
    });

    const recordDate = parsedDemand.createdAt || receivedAtMyanmar;
    const confirmParts = [
      "✅ <b>ဝယ်လိုအားမှတ်တမ်းတင်ခြင်း အောင်မြင်ပါသည်</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      `📅 <b>ရက်စွဲ:</b> <code>${recordDate.toISOString().slice(0, 10)}</code>`,
      ""
    ];
    if (parsedDemand.customerName) confirmParts.push(`👤 <b>Customer:</b> ${parsedDemand.customerName}`);
    if (parsedDemand.serviceName) confirmParts.push(`🛠️ <b>Service:</b> ${parsedDemand.serviceName}`);
    if (parsedDemand.serviceAmount) confirmParts.push(`💰 <b>Amount:</b> ${parsedDemand.serviceAmount.toLocaleString()} Ks`);
    const statusVal = parsedDemand.status || 'new';
    confirmParts.push(`⚙️ <b>Status:</b> <code>${statusVal}</code>`);
    if (parsedDemand.serviceQty) confirmParts.push(`📦 <b>Qty:</b> ${parsedDemand.serviceQty}`);
    if (parsedDemand.followUpDate) confirmParts.push(`📅 <b>Follow-up Date:</b> ${parsedDemand.followUpDate.toISOString().slice(0, 10)}`);
    if (parsedDemand.note) {
      confirmParts.push("");
      confirmParts.push("━━━━━━━━━━━━━━━━━━━━");
      confirmParts.push(`📋 <b>မှတ်စု/အကြောင်းအရာ:</b>\n<i>${parsedDemand.note}</i>`);
    }

    if (analysis.missingFields && analysis.missingFields.length > 0) {
      confirmParts.push("");
      confirmParts.push("⚠️ <b>သတိပေးချက်: အချက်အလက်မပြည့်စုံပါ</b>");
      confirmParts.push("စနစ်မှ တွက်ချက်မှုများ ပိုမိုတိကျစေရန် အောက်ပါအချက်အလက်များကို ဖြည့်စွက်ပေးပါရန် -");
      analysis.missingFields.forEach((field) => {
        confirmParts.push(`• ${getMyanmarFieldName(field)}`);
      });
    }

    confirmParts.push(getFormatHintFooter('demand_report'));

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
