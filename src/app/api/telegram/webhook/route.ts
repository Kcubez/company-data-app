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
  type ParsedDemandRecord,
} from "@/lib/demand-parser";
import { analyzeDemandRecord } from "@/lib/demand-analysis";
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
    [{ text: "📋 Demand Sheet", callback_data: "mode:demand_report" }],
    [{ text: "⏰ Project Expiries", callback_data: "mode:project_expiry" }],
    [{ text: "🔧 Website Updates", callback_data: "mode:website_update" }],
    [{ text: "📊 Business Report", callback_data: "mode:business_report" }],
  ],
};

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
    "📋 <b>ဝယ်လိုအားနှင့် အရောင်းမှတ်တမ်း (Demand Sheet) Mode</b>",
    "",
    "ဤကဏ္ဍတွင် အစီရင်ခံစာ စာသား သို့မဟုတ် သက်ဆိုင်ရာ Excel / CSV ဖိုင်များကို တိုက်ရိုက် ပေးပို့နိုင်ပါသည်။",
    "",
    "📝 <b>စာသားဖြင့် ပေးပို့လိုပါက အောက်ပါပုံစံအတိုင်း ရေးသားပေးပို့နိုင်ပါသည် -</b>",
    "<pre>",
    "• Customer: [Customer နာမည်]",
    "• Phone: [ဖုန်းနံပါတ်]",
    "• Business: [လုပ်ငန်း/ကုမ္ပဏီအမည်]",
    "• Service: [ဝန်ဆောင်မှုအမည်] - Amount: [ဝင်ငွေ] - Qty: [အရေအတွက်]",
    "• Follow-up Date: [YYYY-MM-DD]",
    "• Note: [အခြားမှတ်ချက်]",
    "</pre>",
    "💡 <i>အကြံပြုချက်: မလိုအပ်သော စာကြောင်းများကို ချန်လှပ်ထားနိုင်ပါသည်။ Excel/CSV ဖိုင် တင်သွင်းပါကလည်း AI မှ အလိုအလျောက် ဆန်းစစ်ပေးမည် ဖြစ်ပါသည်။</i>",
  ].join("\n");
}

function getProjectExpiryFormatPrompt(): string {
  return [
    "⏰ <b>ပရောဂျက် သက်တမ်းကုန်ဆုံးမှု မှတ်တမ်း (Project Expiry) Mode</b>",
    "",
    "ဤကဏ္ဍတွင် စီမံကိန်း သက်တမ်းကုန်ဆုံးရက်စွဲများကို တင်သွင်းရန် စာသား သို့မဟုတ် Excel ဖိုင်ကို ပေးပို့နိုင်ပါသည်။",
    "",
    "📝 <b>စာသားဖြင့် ပေးပို့လိုပါက အောက်ပါပုံစံအတိုင်း ရေးသားပေးပို့နိုင်ပါသည် -</b>",
    "<pre>",
    "• Project: [Project အမည်]",
    "• URL: [Website URL]",
    "• Package: [Package အမည်]",
    "• Domain Provider: [Domain ဝန်ဆောင်မှုပေးသူ]",
    "• Hosting Provider: [Hosting ဝန်ဆောင်မှုပေးသူ]",
    "• Hosting Remark: [Hosting မှတ်ချက်]",
    "• Domain Expiry: [YYYY-MM-DD]",
    "• Hosting Expiry: [YYYY-MM-DD]",
    "• Remark: [အခြားမှတ်ချက်]",
    "</pre>",
  ].join("\n");
}

function getWebsiteUpdateFormatPrompt(): string {
  return [
    "🔧 <b>ဝဘ်ဆိုဒ် အပ်ဒိတ်/ထိန်းသိမ်းမှု မှတ်တမ်း (Website Update) Mode</b>",
    "",
    "ဤကဏ္ဍတွင် ဝဘ်ဆိုဒ်အပ်ဒိတ်နှင့် ထိန်းသိမ်းမှု အခြေအနေများကို တင်သွင်းရန် စာသား သို့မဟုတ် Excel ဖိုင်ကို ပေးပို့နိုင်ပါသည်။",
    "",
    "📝 <b>စာသားဖြင့် ပေးပို့လိုပါက အောက်ပါပုံစံအတိုင်း ရေးသားပေးပို့နိုင်ပါသည် -</b>",
    "<pre>",
    "• Name: [ဝဘ်ဆိုဒ်/လုပ်ငန်း အမည်]",
    "• URL: [Website URL]",
    "• Business: [လုပ်ငန်းအမျိုးအစား]",
    "• Package: [Package အမည်]",
    "• Status: [up_to_date / pending_update / in_progress]",
    "• Remark: [အခြားမှတ်ချက်]",
    "</pre>",
  ].join("\n");
}

function getBusinessReportFormatPrompt(): string {
  return [
    "📊 <b>လုပ်ငန်းလှုပ်ရှားမှုနေ့စဉ်/အပတ်စဉ် မှတ်တမ်း (Business Report) Mode</b>",
    "",
    "ဤကဏ္ဍတွင် Marketing, Appointments, Sales ဆိုင်ရာ အချက်အလက်များကို တင်သွင်းနိုင်ပါသည်။ စာသား သို့မဟုတ် Excel ဖိုင် ပေးပို့နိုင်ပါသည်။",
    "",
    "📝 <b>စာသားဖြင့် ပေးပို့လိုပါက အောက်ပါပုံစံအတိုင်း -</b>",
    "<pre>",
    "• Date: [YYYY-MM-DD]",
    "• Marketing Budget: [ကြော်ငြာ ကုန်ကျစရိတ် Ks]",
    "• Channel: [Facebook / Google / Referral / Walk-in / Telegram]",
    "• Calls Made: [ဖုန်းခေါ်ဆိုမှုဦးရေ]",
    "• Appointments Made: [ချိန်းဆိုမှုဦးရေ]",
    "• Appointments Kept: [ဆုံတွေ့မှုဦးရေ]",
    "• New Leads: [ဖောက်သည်သစ်ဦးရေ]",
    "• Total Demand: [Demand မှတ်တမ်းဦးရေ]",
    "• Total Sales: [ရောင်းရငွေ Ks]",
    "• Closed Deals: [ပိတ်သိမ်းနိုင်သောကိစ္စရပ်]",
    "• Pending Deals: [ဆိုင်းငံ့နေသောကိစ္စရပ်]",
    "• Notes: [မှတ်ချက်]",
    "</pre>",
    "💡 <i>Excel ဖိုင် (Business Report format) တင်သွင်းပါကလည်း AI မှ အလိုအလျောက် ဆန်းစစ်ပေးပါမည်။</i>",
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
        "🤖 <b>Q&A ကဏ္ဍတွင် ရှိနေပါသည်။</b>",
        "",
        "ဤကဏ္ဍတွင် ပုံစံ (format) မလိုအပ်ပါ — သိရှိလိုသည်များကို တိုက်ရိုက် မေးမြန်းနိုင်ပါသည်။",
        "အစီရင်ခံစာ တင်သွင်းလိုပါက /menu မှ သက်ဆိုင်ရာ ကဏ္ဍကို ရွေးချယ်ပါ။",
      ].join("\n");
  }
}

// A compact footer reminding the sender of the expected fields for the
// current report mode. Appended to confirmation messages so users can see
// what to include next time without re-opening the menu.
function getFormatHintFooter(mode: string): string {
  let fields = "";
  if (mode === 'demand_report') {
    fields = "Customer • Phone • Business • Service / Amount / Qty • Follow-up Date • Note";
  } else if (mode === 'project_expiry') {
    fields = "Project • URL • Package • Domain / Hosting Provider • Domain / Hosting Expiry • Remark";
  } else if (mode === 'website_update') {
    fields = "Name • URL • Business • Package • Status • Remark";
  } else if (mode === 'business_report') {
    fields = "Date • Budget • Channel • Calls • Appointments • Leads • Sales • Closed Deals • Notes";
  }
  return [
    "",
    "━━━━━━━━━━━━━━━━━━━━",
    `💡 <i>ပိုပြည့်စုံစေရန် ဖြည့်နိုင်သော အကွက်များ:</i>`,
    `<i>${fields}</i>`,
    `<i>ပုံစံ အပြည့်အစုံ ကြည့်ရန် /format ၊ ကူးယူရန် တမ်းပလိတ်အတွက် /template ၊ ကဏ္ဍ ပြောင်းရန် /menu ကို ပေးပို့ပါ။</i>`,
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

function parseExcelDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  const num = Number(val);
  if (!isNaN(num) && num > 0) {
    // Excel base date is Dec 30, 1899 due to 1900 leap year bug
    return new Date(Math.round((num - 25569) * 86400 * 1000));
  }
  const parsed = Date.parse(String(val));
  return isNaN(parsed) ? null : new Date(parsed);
}

function parseFinanceRecordsSpreadsheet(fileBuffer: Buffer): any[] {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const allRecords: any[] = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { raw: true });
    for (const row of rows) {
      const getVal = (keys: string[]) => {
        for (const k of keys) {
          const matchedKey = Object.keys(row).find(
            rk => rk.toLowerCase().trim() === k.toLowerCase()
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
        "📋 <b>Demand Sheet (အရောင်းမှတ်တမ်း) Copy-Paste Template</b>",
        "အောက်ပါစာသားကို နှိပ်၍ Copy ကူးယူပြီး အချက်အလက်များ ဖြည့်စွက်ပေးပို့နိုင်ပါသည် -",
        "",
        "<code>• Customer: \n• Phone: \n• Business: \n• Service:  - Amount:  - Qty: \n• Follow-up Date: \n• Note: </code>",
      ].join("\n");
    case 'project_expiry':
      return [
        "⏰ <b>Project Expiry (သက်တမ်းကုန်ဆုံးမှု) Copy-Paste Template</b>",
        "အောက်ပါစာသားကို နှိပ်၍ Copy ကူးယူပြီး အချက်အလက်များ ဖြည့်စွက်ပေးပို့နိုင်ပါသည် -",
        "",
        "<code>• Project: \n• URL: \n• Package: \n• Domain Provider: \n• Hosting Provider: \n• Hosting Remark: \n• Domain Expiry: \n• Hosting Expiry: \n• Remark: </code>",
      ].join("\n");
    case 'website_update':
      return [
        "🔧 <b>Website Update (ဝဘ်ဆိုဒ်အပ်ဒိတ်) Copy-Paste Template</b>",
        "အောက်ပါစာသားကို နှိပ်၍ Copy ကူးယူပြီး အချက်အလက်များ ဖြည့်စွက်ပေးပို့နိုင်ပါသည် -",
        "",
        "<code>• Name: \n• URL: \n• Business: \n• Package: \n• Status: \n• Remark: </code>",
      ].join("\n");
    case 'business_report':
      return [
        "📊 <b>Business Report (လုပ်ငန်းလှုပ်ရှားမှု) Copy-Paste Template</b>",
        "အောက်ပါစာသားကို နှိပ်၍ Copy ကူးယူပြီး အချက်အလက်များ ဖြည့်စွက်ပေးပို့နိုင်ပါသည် -",
        "",
        "<code>• Date: \n• Marketing Budget: \n• Channel: \n• Calls Made: \n• Appointments Made: \n• Appointments Kept: \n• New Leads: \n• Total Demand: \n• Total Sales: \n• Closed Deals: \n• Pending Deals: \n• Notes: </code>",
      ].join("\n");
    default:
      return [
        "🤖 <b>Q&A သို့မဟုတ် အမျိုးအစားမရွေးချယ်ရသေးသော ကဏ္ဍတွင် ရှိနေပါသည်။</b>",
        "",
        "Template ရရှိရန် /menu မှ ကဏ္ဍတစ်ခုခုကို ရွေးချယ်ပြီးနောက် /template ကို ပြန်လည် ပေးပို့ပါ။",
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
      nameToDetails.set(d.customerName, {
        phone: d.customerPhone || (existing ? existing.phone : null),
        company: d.customerCompany || (existing ? existing.company : null),
      });
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

  const activityCreates = Array.from(rawNameToId.entries()).map(([, id]) => ({
    customerId: id,
    senderId,
    action: 'demand_report',
    description: `File: ${fileName}`,
  }));
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
    "📄 <b>Demand file preview</b>",
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
}: {
  downloadedBuffer: Buffer;
  fileInfo: { fileName: string; mimeType: string; fileSize: number };
  caption?: string;
  settings: { botToken: string | null; geminiApiKey: string | null; geminiModel: string | null };
  chatId: bigint;
  senderId: string;
  telegramMessageId: string;
  progressMsgId: number | null;
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
        const workbook = XLSX.read(downloadedBuffer, { type: 'buffer' });
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
        // Imported sites start as "pending_update" — a freshly uploaded list is a
        // backlog of sites to work through. Team marks each "up_to_date" once done.
        status: "pending_update",
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
        reportDate: rec.reportDate || new Date(),
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
        return {
          reportDate: rec.date,
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
          createdAt: rec.date,
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
                "⌛ <b>Demand file preview expired</b>",
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
              "✅ <b>Demand file imported</b>",
              "━━━━━━━━━━━━━━━━━━━━",
              `📎 <b>File:</b> <code>${escapeHtml(pending.fileName)}</code>`,
              `📊 <b>Imported:</b> <code>${importedCount}</code> records`,
              "",
              "🎯 <b>Priority summary</b>",
              `• High: <b>${summary.high}</b>`,
              `• Medium: <b>${summary.medium}</b>`,
              `• Low: <b>${summary.low}</b>`,
              "",
              "Dashboard မှာ Demand Sheets ကိုကြည့်ပြီး priority/action တွေကို ဆက်လုပ်နိုင်ပါပြီ။",
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
              "❌ <b>Demand file import cancelled</b>",
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
              "• <code>ဘယ် domain / hosting တွေ ရက်အနီးကပ်ဆုံး သက်တမ်းကုန်တော့မလဲ?</code>",
              "• <code>update လုပ်ဖို့ ကျန်နေသေးတဲ့ website ဘယ်နှစ်ခု ရှိလဲ?</code>",
              "• <code>follow-up လုပ်ဖို့ ရှိနေတဲ့ customer တွေက ဘယ်သူတွေလဲ?</code>",
              "",
              "━━━━━━━━━━━━━━━━━━━━",
              "↩️ <b>အဓิက Menu သို့ ပြန်သွားရန်:</b> /start သို့မဟုတ် /menu ဟု ပေးပို့နိုင်ပါသည်။",
            ].join("\n"),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:demand_report') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'demand_report' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Demand Sheet mode selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getFormatPrompt(),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:project_expiry') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'project_expiry' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Project Expiry mode selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getProjectExpiryFormatPrompt(),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:website_update') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'website_update' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Website Update mode selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getWebsiteUpdateFormatPrompt(),
          });
        }
        return NextResponse.json({ ok: true });
      }

      if (data === 'mode:business_report') {
        await prisma.telegramSender.update({
          where: { id: sender.id },
          data: { activeReportType: 'business_report' },
        });
        await answerCallbackQuery(settings?.botToken, callbackQuery.id, 'Business Report mode selected');
        if (chatId && messageId) {
          await editTelegramMessage({
            botToken: settings?.botToken,
            chatId: BigInt(chatId),
            messageId,
            text: getBusinessReportFormatPrompt(),
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

    if (message.text === '/format') {
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: getFormatPromptForMode(sender.activeReportType),
      });
      return NextResponse.json({ ok: true });
    }

    if (message.text === '/template') {
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: getCopyPasteTemplateForMode(sender.activeReportType),
      });
      return NextResponse.json({ ok: true });
    }

    if (message.text === '/start' || message.text === '/menu') {
      await sendTelegramMessage({
        botToken: settings?.botToken,
        chatId,
        text: [
          "👋 <b>မင်္ဂလာပါ ခင်ဗျာ/ရှင်။</b>",
          "",
          "<b>Business AI Integration System</b> မှ လှိုက်လှဲစွာ ကြိုဆိုပါသည်။",
          "လုပ်ဆောင်လိုသည့် လုပ်ငန်းစဉ်အမျိုးအစားကို အောက်ပါ Menu မှ ရွေးချယ်ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
          "",
          "━━━━━━━━━━━━━━━━━━━━",
          "🤖 <b>Q&A မေးမြန်းရန်:</b> လုပ်ငန်းဆိုင်ရာ အချက်အလက်များကို AI ဖြင့် မေးမြန်းဆန်းစစ်ရန်။",
          "📋 <b>Demand Sheet:</b> ဝယ်လိုအားနှင့် အရောင်းမှတ်တမ်းများ တင်သွင်းရန်။",
          "⏰ <b>Project Expiries:</b> သက်တမ်းကုန်ဆုံးမည့်ရက်များ တင်သွင်းရန်။",
          "🔧 <b>Website Updates:</b> အပ်ဒိတ်/ထိန်းသိမ်းမှု အခြေအနေများ တင်သွင်းရန်။",
          "━━━━━━━━━━━━━━━━━━━━",
          "💡 <i>ကဏ္ဍ ရွေးပြီးနောက် ပုံစံများကြည့်ရန် /format သို့မဟုတ် ကူးယူရန် တမ်းပလိတ်အတွက် /template ကို ပေးပို့နိုင်ပါသည်။</i>",
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
            "အစီရင်ခံစာ (Report) တင်သွင်းရန်အတွက် Demand Sheet Mode သို့ ပြောင်းလဲပေးပို့ပေးပါရန် မေတ္တာရပ်ခံအပ်ပါသည်။",
            "/start သို့မဟုတ် /menu ကိုနှိပ်၍ 'Demand Sheet' ကို ရွေးချယ်နိုင်ပါသည်။",
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
    const updatedSender = await prisma.telegramSender.update({
      where: { id: sender.id },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });

    const isBusinessReport = message.text ? isBusinessReportText(message.text) : false;
    const activeMode = isBusinessReport ? 'business_report' : updatedSender.activeReportType;

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
        },
      });

      const confirmParts = [
        "✅ <b>သက်တမ်းကုန်ဆုံးမှုမှတ်တမ်း တင်သွင်းခြင်း အောင်မြင်ပါသည်</b>",
        "━━━━━━━━━━━━━━━━━━━━",
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
        },
      });

      const confirmParts = [
        "✅ <b>ဝဘ်ဆိုဒ် အပ်ဒိတ်/ထိန်းသိမ်းမှု မှတ်တမ်း တင်သွင်းခြင်း အောင်မြင်ပါသည်</b>",
        "━━━━━━━━━━━━━━━━━━━━",
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
      receivedAt,
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
            ...(parsedDemand.customerPhone ? { phone: parsedDemand.customerPhone } : {}),
            ...(parsedDemand.customerCompany ? { company: parsedDemand.customerCompany } : {}),
          },
        });
      } else {
        customer = await prisma.customer.create({
          data: {
            name: parsedDemand.customerName,
            nameNormalized: normalizedName,
            phone: parsedDemand.customerPhone || null,
            company: parsedDemand.customerCompany || null,
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
      },
    });

    const confirmParts = [
      "✅ <b>ဝယ်လိုအားမှတ်တမ်းတင်ခြင်း အောင်မြင်ပါသည်</b>",
      "━━━━━━━━━━━━━━━━━━━━",
      ""
    ];
    if (parsedDemand.customerName) confirmParts.push(`👤 <b>Customer:</b> ${parsedDemand.customerName}`);
    if (parsedDemand.serviceName) confirmParts.push(`🛠️ <b>Service:</b> ${parsedDemand.serviceName}`);
    if (parsedDemand.serviceAmount) confirmParts.push(`💰 <b>Amount:</b> ${parsedDemand.serviceAmount.toLocaleString()} Ks`);
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
