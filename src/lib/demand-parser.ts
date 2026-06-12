import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";

export const REPORT_TYPES = {
  DEMAND_REPORT: "demand_report",
  QA: "qa",
  PROJECT_EXPIRY: "project_expiry",
  WEBSITE_UPDATE: "website_update",
  BUSINESS_REPORT: "business_report",
} as const;

export type ReportType = (typeof REPORT_TYPES)[keyof typeof REPORT_TYPES];

export function isReportType(value: string | null | undefined): value is ReportType {
  return (
    value === REPORT_TYPES.DEMAND_REPORT ||
    value === REPORT_TYPES.QA ||
    value === REPORT_TYPES.PROJECT_EXPIRY ||
    value === REPORT_TYPES.WEBSITE_UPDATE ||
    value === REPORT_TYPES.BUSINESS_REPORT
  );
}

export type ParsedDemandRecord = {
  customerName: string | null;
  customerPhone: string | null;
  customerCompany: string | null;
  category: string;
  status: string;
  note: string;
  confidence: number;
  aiProvider: string;
  aiModel: string | null;
  followUpDate: Date | null;
  serviceName: string | null;
  serviceAmount: number | null;
  serviceQty: number | null;
  createdAt?: Date | null;
};

async function generateContentWithRetry(
  genAI: GoogleGenAI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: { model: string; contents: string | any[] },
  maxRetries = 3,
  delayMs = 1500
): Promise<{ text?: string }> {
  let lastError: unknown = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await (genAI.models.generateContent(options) as Promise<{ text?: string }>);
      return response;
    } catch (err) {
      lastError = err;
      const status = typeof err === 'object' && err !== null ? (err as Record<string, unknown>).status || (err as Record<string, unknown>).statusCode : undefined;
      const errStr = typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      
      if (
        status === 503 ||
        status === 429 ||
        errStr.includes('503') ||
        errStr.includes('429') ||
        errStr.toLowerCase().includes('unavailable') ||
        errStr.toLowerCase().includes('high demand') ||
        errStr.toLowerCase().includes('overloaded') ||
        errStr.toLowerCase().includes('socket') ||
        errStr.toLowerCase().includes('fetch failed')
      ) {
        console.warn(`Gemini API returned retryable error (attempt ${i + 1}/${maxRetries}):`, errMsg);
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, i)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

const BURMESE_DIGITS: Record<string, string> = {
  '\u1040': '0', '\u1041': '1', '\u1042': '2', '\u1043': '3', '\u1044': '4',
  '\u1045': '5', '\u1046': '6', '\u1047': '7', '\u1048': '8', '\u1049': '9',
};

function convertBurmeseDigits(text: string): string {
  return text.replace(/[\u1040-\u1049]/g, (d) => BURMESE_DIGITS[d] || d);
}

function extractNumber(text: string, patterns: RegExp[]): number | null {
  const normalized = convertBurmeseDigits(text);
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const num = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(num) && num >= 0) return num;
    }
  }
  return null;
}

function extractString(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const val = match[1].trim();
      if (val.length >= 1 && val.length <= 200) return val;
    }
  }
  return null;
}

function cleanValue(value: string): string {
  return value.replace(/^[:\-=\s]+/, '').replace(/[\s.,:;]+$/, '').trim();
}

function parseDemandSheet(text: string): Partial<ParsedDemandRecord> {
  const customerName = extractString(text, [
    /(?:customer|client|name|fb account Name|fb account)\s*[:=-]?\s*([^\n,]+)/i,
  ]);

  const customerPhone = extractString(text, [
    /(?:phone|ph|contact|ph no|phone no|tel|ph_no)\s*[:=-]?\s*([0-9+\-\s]+)/i,
  ]);

  const customerCompany = extractString(text, [
    /(?:business|company|org|shop|industry|company name)\s*[:=-]?\s*([^\n,]+)/i,
  ]);

  const serviceName = extractString(text, [
    /(?:service|package|product)\s*[:=-]?\s*([^\n,\-]+?)(?:\s*[-:]|\s+amount|\s+qty|$)/i,
  ]);

  const serviceAmount = extractNumber(text, [
    /(?:service.*?amount|package.*?amount|amount|revenue|income|price)\s*[:=-]?\s*([\d,]+\.?\d*)/i,
  ]);

  const serviceQty = extractNumber(text, [
    /(?:service.*?qty|package.*?qty|qty|quantity)\s*[:=-]?\s*([\d,]+)/i,
  ]);

  const followUpDateStr = extractString(text, [
    /(?:follow[\s-]?up[\s-]?date|next[\s-]?fu|next[\s-]?fu[\s-]?date|date|fu[\s-]?date)\s*[:=-]?\s*([^\n]+)/i,
  ]);

  let followUpDate: Date | null = null;
  if (followUpDateStr) {
    const parsedDate = Date.parse(followUpDateStr.trim());
    if (!isNaN(parsedDate)) {
      followUpDate = new Date(parsedDate);
    }
  }

  return {
    customerName: customerName ? cleanValue(customerName) : null,
    customerPhone: customerPhone ? cleanValue(customerPhone) : null,
    customerCompany: customerCompany ? cleanValue(customerCompany) : null,
    serviceName: serviceName ? cleanValue(serviceName) : null,
    serviceAmount,
    serviceQty: serviceQty ? Math.round(serviceQty) : null,
    followUpDate,
  };
}

export function parseDemandMessage(text: string, _reportType?: ReportType): ParsedDemandRecord {
  const baseRecord: ParsedDemandRecord = {
    customerName: null,
    customerPhone: null,
    customerCompany: null,
    category: 'general',
    status: 'new',
    note: text.trim(),
    confidence: 0.35,
    aiProvider: 'heuristic',
    aiModel: null,
    followUpDate: null,
    serviceName: null,
    serviceAmount: null,
    serviceQty: null,
  };

  const extracted = parseDemandSheet(text);
  Object.assign(baseRecord, extracted);
  baseRecord.category = 'demand';
  const fieldsFound = [
    extracted.customerName,
    extracted.customerPhone,
    extracted.customerCompany,
    extracted.serviceName,
    extracted.serviceAmount,
    extracted.followUpDate
  ].filter(v => v !== null && v !== undefined).length;
  baseRecord.confidence = Math.min(0.35 + fieldsFound * 0.12, 0.85);

  return baseRecord;
}

function buildGeminiPrompt(text: string): string {
  return `You are a business demand sheet data extractor. Extract structured data from this business report message.
The message may be in Burmese (Myanmar) or English or mixed.

Message:
"""${text}"""

Extract and return a JSON object with these fields:
{
  "note": string (clean summary of the call notes, chat notes, or remarks),
  "customerName": string | null (client / customer name if mentioned),
  "customerPhone": string | null (client's phone number if mentioned),
  "customerCompany": string | null (client's business/company name or shop name if mentioned),
  "serviceName": string | null (must be one of these exact values: "Website Gold Package", "Website Silver Package", "Website Diamond Package", "Messenger Sale Bot", "Telegram Sale Bot", "Genius AutoWriter", "Genius Board", "SOP Generator", "POS", "EMS", "AI for careers ebook", "AI for businesses ebook", "Prompt Packs ebook", or "Other"),
  "serviceAmount": number | null (revenue / package amount from the service),
  "serviceQty": number | null (quantity sold),
  "followUpDate": string | null (next follow-up date in YYYY-MM-DD format if mentioned),
  "category": "sales" | "inquiry" | "follow_up" | "general",
  "status": "new" | "contacted" | "quoted" | "pending" | "closed"
}

Rules:
- Extract numbers even if written in Burmese digits.
- If a field is not mentioned, set it to null.
- Return ONLY valid JSON, no explanation.`;
}

export async function parseDemandMessageWithGemini({
  text,
  apiKey,
  model,
}: {
  text: string;
  receivedAt?: Date;
  reportType?: ReportType;
  apiKey?: string | null;
  model?: string | null;
}): Promise<ParsedDemandRecord> {
  const fallback = parseDemandMessage(text);

  if (!apiKey) return fallback;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-3.1-flash-lite-preview';
    const prompt = buildGeminiPrompt(text);

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: prompt,
    });

    const responseText = response?.text;
    if (!responseText) return fallback;

    const cleanedJson = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleanedJson);

    let followUpDate: Date | null = null;
    if (parsed.followUpDate) {
      const parsedDate = Date.parse(parsed.followUpDate);
      if (!isNaN(parsedDate)) {
        followUpDate = new Date(parsedDate);
      }
    }

    return {
      ...fallback,
      aiProvider: 'gemini',
      aiModel: modelName,
      confidence: 0.9,
      note: typeof parsed.note === 'string' ? parsed.note : fallback.note,
      customerName: parsed.customerName || fallback.customerName,
      customerPhone: parsed.customerPhone || fallback.customerPhone,
      customerCompany: parsed.customerCompany || fallback.customerCompany,
      category: parsed.category || fallback.category,
      status: parsed.status || fallback.status,
      serviceName: parsed.serviceName || fallback.serviceName,
      serviceAmount: typeof parsed.serviceAmount === 'number' ? parsed.serviceAmount : fallback.serviceAmount,
      serviceQty: typeof parsed.serviceQty === 'number' ? parsed.serviceQty : fallback.serviceQty,
      followUpDate: followUpDate || fallback.followUpDate,
    };
  } catch (error) {
    console.error('Gemini parsing failed, using heuristic fallback:', error);
    return fallback;
  }
}

export async function answerQuestionWithGemini({
  question,
  context,
  apiKey,
  model,
}: {
  question: string;
  context: string;
  apiKey: string;
  model?: string | null;
}): Promise<string> {
  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-3.1-flash-lite-preview';

    const prompt = `You are a helpful business assistant. Answer the user's question based on the business data context provided below.
Answer in the same language the user asked in (Burmese or English).
Be concise but helpful. If the data doesn't contain enough info, say so honestly.

=== BUSINESS DATA CONTEXT ===
${context}
=== END CONTEXT ===

User's question: ${question}

Answer:`;

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: prompt,
    });

    return response?.text || 'Sorry, I could not generate an answer.';
  } catch (error) {
    console.error('Gemini Q&A failed:', error);
    return 'Sorry, AI service is currently unavailable. Please try again later.';
  }
}

// ─── File Extraction ─────────────────────────────────────────────────────────

const TEXT_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'text/html',
  'text/markdown',
  'application/json',
  'application/xml',
  'text/xml',
]);

const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
]);

export function isSpreadsheetFile(mimeType: string, fileName: string): boolean {
  if (SPREADSHEET_MIME_TYPES.has(mimeType)) return true;
  const lower = fileName.toLowerCase();
  return lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm') || lower.endsWith('.csv');
}

export function extractSpreadsheetToText(buffer: Buffer): string {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const parts: string[] = [];
  for (const sheetName of workbook.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
    if (csv.trim()) {
      parts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
    }
  }
  return parts.join('\n\n') || '(empty spreadsheet)';
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function isFileTooLarge(sizeBytes: number): boolean {
  return sizeBytes > MAX_FILE_SIZE;
}

function buildFileExtractionPrompt(caption?: string): string {
  const captionNote = caption
    ? `\nThe user also provided this caption/context: "${caption}"\n`
    : '';

  return `You are a business demand sheet data extractor. Extract ALL text and data from the uploaded file.
The content may be in Burmese (Myanmar) or English or mixed.${captionNote}

The file may contain MANY rows / clients / demands. You MUST extract one structured record per logical entry — do NOT collapse multiple clients or rows into a single record. If the file is a single short report with only one demand, return a one-element array.

First, provide a complete text extraction of everything in the file.
Then, extract structured data and return a JSON ARRAY (one element per demand/row/client).

Return your response in this exact format:

EXTRACTED_TEXT:
[All text content from the file goes here]

STRUCTURED_DATA:
\`\`\`json
[
  {
    "note": string (clean summary of the call notes, chat notes, or remarks for this entry),
    "customerName": string | null (customer name from 'FB account Name' or similar name columns),
    "customerPhone": string | null (customer phone number if mentioned, e.g. from 'Phone', 'ph', or contact columns),
    "customerCompany": string | null (customer business/company name or shop name if mentioned, e.g. from 'Business', 'Company', or shop columns),
    "serviceName": string | null (must be one of these exact values: "Website Gold Package", "Website Silver Package", "Website Diamond Package", "Messenger Sale Bot", "Telegram Sale Bot", "Genius AutoWriter", "Genius Board", "SOP Generator", "POS", "EMS", "AI for careers ebook", "AI for businesses ebook", "Prompt Packs ebook", or "Other"),
    "serviceAmount": number | null (revenue / package price),
    "serviceQty": number | null (quantity),
    "followUpDate": string | null (next follow-up date in YYYY-MM-DD format if mentioned, e.g. from 'Next FU Date' or similar columns),
    "createdAt": string | null (original date / row date in YYYY-MM-DD format if mentioned, e.g. from 'Date' or similar columns),
    "category": "sales" | "inquiry" | "follow_up" | "general",
    "status": "new" | "contacted" | "quoted" | "pending" | "closed"
  }
]
\`\`\`

Rules:
- Return a JSON ARRAY, not a single object.
- Create one array element per client / row / demand in the file. If the file has 49 demands, return 49 (or more) elements.
- Extract ALL text content from the file into EXTRACTED_TEXT, even if it doesn't fit the structured fields.
- If a structured field is not found for an entry, set it to null.
- Return BOTH the extracted text AND the JSON array.`;
}

function buildSpreadsheetExtractionPrompt(headers: unknown[], caption?: string): string {
  const captionNote = caption
    ? `\nThe user also provided this caption/context: "${caption}"\n`
    : '';

  const headerList = headers.map(h => `'${h}'`).join(', ');

  return `You are a business demand spreadsheet parser. Extract structured data from this sheet chunk.
The spreadsheet has these headers: [${headerList}].
The content may be in Burmese (Myanmar) or English or mixed.${captionNote}

For each data row, extract:
- "customerName": extract the client/customer name from name columns (e.g. 'FB account Name', 'FB account', 'Client Name', etc.).
- "customerPhone": extract the client/customer phone number (e.g. from 'Phone', 'ph', 'Phone no', etc.).
- "customerCompany": extract the client/customer business/company name or shop name (e.g. from 'Business', 'Company', 'Shop', etc.).
- "note": extract/summarize remarks, chat/call notes, and business description (e.g. from 'Remarks', 'Call notes / Chat notes', 'Hp & Fu & No Potential', etc.).
- "serviceName": extract service or package name (must be classified into one of: "Website Gold Package", "Website Silver Package", "Website Diamond Package", "Messenger Sale Bot", "Telegram Sale Bot", "Genius AutoWriter", "Genius Board", "SOP Generator", "POS", "EMS", "AI for careers ebook", "AI for businesses ebook", "Prompt Packs ebook", or "Other").
- "serviceAmount": extract package price/amount.
- "serviceQty": quantity of services/items.
- "followUpDate": extract next follow-up date in YYYY-MM-DD format (e.g. from 'Next FU Date').
- "createdAt": extract record/row date in YYYY-MM-DD format (e.g. from 'Date' or similar date columns).

Return your response in this exact format:

EXTRACTED_TEXT:
[Plain text summary of all rows in this chunk]

STRUCTURED_DATA:
\`\`\`json
[
  {
    "note": string,
    "customerName": string | null,
    "customerPhone": string | null,
    "customerCompany": string | null,
    "serviceName": string | null (must be one of: "Website Gold Package", "Website Silver Package", "Website Diamond Package", "Messenger Sale Bot", "Telegram Sale Bot", "Genius AutoWriter", "Genius Board", "SOP Generator", "POS", "EMS", "AI for careers ebook", "AI for businesses ebook", "Prompt Packs ebook", or "Other"),
    "serviceAmount": number | null,
    "serviceQty": number | null,
    "followUpDate": string | null,
    "createdAt": string | null,
    "category": "sales" | "inquiry" | "follow_up" | "general",
    "status": "new" | "contacted" | "quoted" | "pending" | "closed"
  }
]
\`\`\`

Rules:
- Return a JSON ARRAY, not a single object.
- Create exactly one array element per data row.
- If a value is not present in a row, use null.`;
}

function parseFileExtractionResponse(
  responseText: string
): { extractedText: string; records: Record<string, unknown>[] } {
  let extractedText = responseText;
  let records: Record<string, unknown>[] = [];

  const textMatch = responseText.match(
    /EXTRACTED_TEXT:\s*\n([\s\S]*?)(?=STRUCTURED_DATA:|$)/i,
  );
  if (textMatch) {
    extractedText = textMatch[1].trim();
  }

  const jsonMatch = responseText.match(/```json\s*\n?([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1].trim());
      if (Array.isArray(parsed)) {
        records = parsed.filter((r) => r && typeof r === 'object') as Record<string, unknown>[];
      } else if (parsed && typeof parsed === 'object') {
        records = [parsed as Record<string, unknown>];
      }
    } catch {
      console.error('Failed to parse structured data JSON from file extraction');
    }
  }

  return { extractedText, records };
}

function buildRecordFromStructuredData(
  structuredData: Record<string, unknown>,
  extractedText: string,
  modelName: string
): ParsedDemandRecord {
  const fallback = parseDemandMessage(
    (structuredData.note as string) || extractedText.slice(0, 500)
  );

  let followUpDate: Date | null = null;
  if (structuredData.followUpDate) {
    const parsedDate = Date.parse(String(structuredData.followUpDate));
    if (!isNaN(parsedDate)) {
      followUpDate = new Date(parsedDate);
    }
  }

  let createdAt: Date | null = null;
  if (structuredData.createdAt) {
    const parsedDate = Date.parse(String(structuredData.createdAt));
    if (!isNaN(parsedDate)) {
      createdAt = new Date(parsedDate);
    }
  }

  return {
    ...fallback,
    aiProvider: 'gemini',
    aiModel: modelName,
    confidence: 0.85,
    note: (structuredData.note as string) || extractedText.slice(0, 500),
    customerName: (structuredData.customerName as string) || null,
    customerPhone: (structuredData.customerPhone as string) || null,
    customerCompany: (structuredData.customerCompany as string) || null,
    category: (structuredData.category as string) || fallback.category,
    status: (structuredData.status as string) || fallback.status,
    serviceName: (structuredData.serviceName as string) || null,
    serviceAmount: typeof structuredData.serviceAmount === 'number' ? structuredData.serviceAmount : null,
    serviceQty: typeof structuredData.serviceQty === 'number' ? structuredData.serviceQty : null,
    followUpDate,
    createdAt: createdAt || undefined,
  };
}

export async function extractDataFromFile({
  fileBuffer,
  mimeType,
  fileName,
  caption,
  apiKey,
  model,
  onProgress,
}: {
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
  reportType?: ReportType;
  caption?: string;
  apiKey: string;
  model?: string | null;
  onProgress?: (current: number, total: number, errorMsg?: string) => Promise<void> | void;
}): Promise<{ extractedText: string; parsed: ParsedDemandRecord[] }> {
  const genAI = new GoogleGenAI({ apiKey });
  const modelName = model || 'gemini-3.1-flash-lite-preview';
  const prompt = buildFileExtractionPrompt(caption);

  const isTextFile = TEXT_MIME_TYPES.has(mimeType);
  const isSpreadsheet = isSpreadsheetFile(mimeType, fileName);

  if (isSpreadsheet) {
    try {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const allExtractedTexts: string[] = [];
      const allParsedRecords: ParsedDemandRecord[] = [];
      const batchSize = 5;

      let totalChunks = 0;
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        if (rows.length === 0) continue;
        const dataRows = rows.slice(1).filter((row) => {
          if (!row || !Array.isArray(row) || row.length === 0) return false;
          const hasValues = row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
          if (!hasValues) return false;
          const firstCell = String(row[0] || '').trim().toLowerCase();
          if (firstCell.includes('total') || firstCell.includes('summary')) return false;
          return true;
        });
        if (dataRows.length === 0) continue;
        if (dataRows.length <= batchSize) {
          totalChunks += 1;
        } else {
          totalChunks += Math.ceil(dataRows.length / batchSize);
        }
      }

      let processedChunks = 0;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1 });
        if (rows.length === 0) continue;

        const headerRow = rows[0];
        const dataRows = rows.slice(1).filter((row) => {
          if (!row || !Array.isArray(row) || row.length === 0) return false;
          const hasValues = row.some(cell => cell !== null && cell !== undefined && String(cell).trim() !== '');
          if (!hasValues) return false;
          const firstCell = String(row[0] || '').trim().toLowerCase();
          if (firstCell.includes('total') || firstCell.includes('summary')) return false;
          return true;
        });

        if (dataRows.length === 0) continue;

        if (dataRows.length <= batchSize) {
          processedChunks++;
          const subGrid = [headerRow, ...dataRows];
          const subSheet = XLSX.utils.aoa_to_sheet(subGrid);
          const csv = XLSX.utils.sheet_to_csv(subSheet);
          if (!csv.trim()) {
            if (onProgress) {
              await onProgress(processedChunks, totalChunks);
            }
            continue;
          }

          const textContent = `=== Sheet: ${sheetName} ===\n${csv}`;
          const sheetPrompt = buildSpreadsheetExtractionPrompt(headerRow, caption);
          const fullPrompt = `${sheetPrompt}\n\nFile name: ${fileName}\nFile content:\n"""\n${textContent}\n"""`;

          try {
            const response = await generateContentWithRetry(genAI, {
              model: modelName,
              contents: fullPrompt,
            });
            const resText = response?.text || '';
            if (resText) {
              const { extractedText, records } = parseFileExtractionResponse(resText);
              allExtractedTexts.push(extractedText);
              records.forEach((structuredData) => {
                allParsedRecords.push(buildRecordFromStructuredData(structuredData, extractedText, modelName));
              });
            }
            if (onProgress) {
              await onProgress(processedChunks, totalChunks);
            }
          } catch (err) {
            console.error(`Error processing sheet ${sheetName}:`, err);
            const errMessage = err instanceof Error ? err.message : String(err);
            if (onProgress) {
              await onProgress(processedChunks, totalChunks, `Sheet '${sheetName}' error: ${errMessage}`);
            }
          }
        } else {
          const chunkSize = batchSize;
          const chunks: unknown[][][] = [];
          for (let i = 0; i < dataRows.length; i += chunkSize) {
            chunks.push(dataRows.slice(i, i + chunkSize));
          }

          for (let idx = 0; idx < chunks.length; idx++) {
            processedChunks++;
            const chunk = chunks[idx];
            const subGrid = [headerRow, ...chunk];
            const subSheet = XLSX.utils.aoa_to_sheet(subGrid);
            const csv = XLSX.utils.sheet_to_csv(subSheet);

            const textContent = `=== Sheet: ${sheetName} (Rows ${idx * chunkSize + 1} to ${idx * chunkSize + chunk.length}) ===\n${csv}`;
            const sheetPrompt = buildSpreadsheetExtractionPrompt(headerRow, caption);
            const fullPrompt = `${sheetPrompt}\n\nFile name: ${fileName}\nFile content:\n"""\n${textContent}\n"""`;

            try {
              if (idx > 0) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }

              const response = await generateContentWithRetry(genAI, {
                model: modelName,
                contents: fullPrompt,
              });
              const resText = response?.text || '';
              if (resText) {
                const { extractedText, records } = parseFileExtractionResponse(resText);
                allExtractedTexts.push(extractedText);
                records.forEach((structuredData) => {
                  allParsedRecords.push(buildRecordFromStructuredData(structuredData, extractedText, modelName));
                });
              }
              if (onProgress) {
                await onProgress(processedChunks, totalChunks);
              }
            } catch (chunkErr) {
              console.error(`Error processing chunk ${idx + 1} of sheet ${sheetName}:`, chunkErr);
              const errMsg = chunkErr instanceof Error ? chunkErr.message : String(chunkErr);
              if (onProgress) {
                await onProgress(processedChunks, totalChunks, `Sheet '${sheetName}' chunk ${idx + 1} error: ${errMsg}`);
              }
            }
          }
        }
      }

      return {
        extractedText: allExtractedTexts.join('\n\n') || `[Spreadsheet: ${fileName}] - Extracted content`,
        parsed: allParsedRecords.length > 0 ? allParsedRecords : [
          {
            ...parseDemandMessage(`File processed: ${fileName}`),
            aiProvider: 'gemini',
            aiModel: modelName,
            confidence: 0.1,
          }
        ]
      };
    } catch (spreadSheetErr) {
      console.error('Spreadsheet processing error, falling back to basic extraction:', spreadSheetErr);
    }
  }

  // Fallback for non-spreadsheet (text files, images, PDFs)
  let responseText: string;

  if (isTextFile) {
    const textContent = fileBuffer.toString('utf-8');
    const fullPrompt = `${prompt}\n\nFile name: ${fileName}\nFile content:\n"""\n${textContent}\n"""`;

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: fullPrompt,
    });
    responseText = response?.text || '';
  } else {
    const base64Data = fileBuffer.toString('base64');

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType,
                data: base64Data,
              },
            },
            { text: `File name: ${fileName}\n\n${prompt}` },
          ],
        },
      ],
    });
    responseText = response?.text || '';
  }

  if (!responseText) {
    return {
      extractedText: `[File: ${fileName}] - Could not extract content`,
      parsed: [
        {
          ...parseDemandMessage(`File uploaded: ${fileName}`),
          aiProvider: 'gemini',
          aiModel: modelName,
          confidence: 0.1,
        },
      ],
    };
  }

  const { extractedText, records } = parseFileExtractionResponse(responseText);

  if (records.length === 0) {
    return {
      extractedText,
      parsed: [
        {
          ...parseDemandMessage(extractedText.slice(0, 500)),
          aiProvider: 'gemini',
          aiModel: modelName,
          confidence: 0.3,
        },
      ],
    };
  }

  const parsed = records.map((structuredData) =>
    buildRecordFromStructuredData(structuredData, extractedText, modelName)
  );

  return { extractedText, parsed };
}

// ─── Project Expiration Parser ──────────────────────────────────────────────

export type ParsedProjectExpiration = {
  projectName: string;
  url: string | null;
  packageName: string | null;
  domainProvider: string | null;
  hostingProvider: string | null;
  hostingRemark: string | null;
  domainExpireDate: Date | null;
  hostingExpireDate: Date | null;
  remark: string | null;
};

export function parseExcelDate(val: any): Date | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) return val;
  const num = Number(val);
  if (!isNaN(num) && num > 0) {
    return new Date(Math.round((num - 25569) * 86400 * 1000));
  }
  const str = String(val).trim();
  if (!str) return null;
  const parsed = Date.parse(str);
  if (!isNaN(parsed)) return new Date(parsed);
  return null;
}

export function isProjectExpiryHeaders(headers: string[]): boolean {
  const normalized = headers.map(h => String(h || '').trim().toLowerCase());
  return (
    normalized.includes('domain expiration date') ||
    normalized.includes('hosting expiration date') ||
    normalized.includes('check list')
  );
}

export function parseProjectExpirySpreadsheet(fileBuffer: Buffer): ParsedProjectExpiration[] {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const allRecords: ParsedProjectExpiration[] = [];

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

      const projectName = String(getVal(['Check List', 'Project Name', 'Name']) || '').trim();
      if (!projectName) continue;

      const url = String(getVal(['URL', 'Link']) || '').trim() || null;
      const packageName = String(getVal(['Package']) || '').trim() || null;
      const domainProvider = String(getVal(['Domain Provider']) || '').trim() || null;
      const hostingProvider = String(getVal(['Hosting Provider']) || '').trim() || null;
      const hostingRemark = String(getVal(['Hosting Remark']) || '').trim() || null;
      const domainExpireDate = parseExcelDate(getVal(['Domain Expiration Date', 'Domain Expiry']));
      const hostingExpireDate = parseExcelDate(getVal(['Hosting Expiration Date', 'Hosting Expiry']));
      const remark = String(getVal(['Remark', 'Remarks']) || '').trim() || null;

      allRecords.push({
        projectName,
        url,
        packageName,
        domainProvider,
        hostingProvider,
        hostingRemark,
        domainExpireDate,
        hostingExpireDate,
        remark,
      });
    }
  }

  return allRecords;
}

export type ParsedWebsiteUpdate = {
  name: string;
  url: string | null;
  businessType: string | null;
  packageName: string | null;
};

export function isWebsiteUpdateHeaders(headers: string[]): boolean {
  const normalized = headers.map(h => String(h || '').trim().toLowerCase());
  return (
    (normalized.includes('website link') || normalized.includes('website_link') || normalized.includes('website-link')) &&
    (normalized.includes('business type') || normalized.includes('business_type') || normalized.includes('business-type') || normalized.includes('business')) &&
    (normalized.includes('name') || normalized.includes('project name') || normalized.includes('project_name'))
  );
}

export function parseWebsiteUpdateSpreadsheet(fileBuffer: Buffer): ParsedWebsiteUpdate[] {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const allRecords: ParsedWebsiteUpdate[] = [];

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

      const name = String(getVal(['Name', 'Project Name', 'Project_Name']) || '').trim();
      if (!name) continue;

      const url = String(getVal(['Website Link', 'Website_Link', 'URL', 'Link']) || '').trim() || null;
      const businessType = String(getVal(['Business Type', 'Business_Type', 'Business']) || '').trim() || null;
      const packageName = String(getVal(['Package', 'Package Name', 'Package_Name']) || '').trim() || null;

      allRecords.push({
        name,
        url,
        businessType,
        packageName,
      });
    }
  }

  return allRecords;
}

export async function parseProjectExpiryMessageWithGemini({
  text,
  apiKey,
  model,
}: {
  text: string;
  apiKey?: string | null;
  model?: string | null;
}): Promise<ParsedProjectExpiration> {
  const fallback = parseProjectExpiryMessage(text);
  if (!apiKey) return fallback;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-3.1-flash-lite-preview';
    const prompt = `You are a project expiration data extractor. Extract structured data from this message.
Message:
"""${text}"""

Extract and return a JSON object with these fields:
{
  "projectName": string (required, name of the project / client website),
  "url": string | null (website link/URL),
  "packageName": string | null (subscription package name),
  "domainProvider": string | null (domain provider, e.g. Namecheap, GoDaddy),
  "hostingProvider": string | null (hosting provider, e.g. DigitalOcean, AWS),
  "hostingRemark": string | null (hosting notes/remarks),
  "domainExpireDate": string | null (domain expiration date in YYYY-MM-DD format),
  "hostingExpireDate": string | null (hosting expiration date in YYYY-MM-DD format),
  "remark": string | null (any general remarks or notes)
}

Rules:
- If a field is not mentioned, set it to null.
- Return ONLY valid JSON, no explanation.`;

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: prompt,
    });

    const responseText = response?.text;
    if (!responseText) return fallback;

    const cleanedJson = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleanedJson);

    let domainExpireDate: Date | null = null;
    if (parsed.domainExpireDate) {
      const p = Date.parse(parsed.domainExpireDate);
      if (!isNaN(p)) domainExpireDate = new Date(p);
    }

    let hostingExpireDate: Date | null = null;
    if (parsed.hostingExpireDate) {
      const p = Date.parse(parsed.hostingExpireDate);
      if (!isNaN(p)) hostingExpireDate = new Date(p);
    }

    return {
      projectName: parsed.projectName || fallback.projectName,
      url: parsed.url || fallback.url,
      packageName: parsed.packageName || fallback.packageName,
      domainProvider: parsed.domainProvider || fallback.domainProvider,
      hostingProvider: parsed.hostingProvider || fallback.hostingProvider,
      hostingRemark: parsed.hostingRemark || fallback.hostingRemark,
      domainExpireDate: domainExpireDate || fallback.domainExpireDate,
      hostingExpireDate: hostingExpireDate || fallback.hostingExpireDate,
      remark: parsed.remark || fallback.remark,
    };
  } catch (err) {
    console.error("Gemini project expiry text parse failed:", err);
    return fallback;
  }
}

export function parseProjectExpiryMessage(text: string): ParsedProjectExpiration {
  const getVal = (keys: string[]) => {
    for (const k of keys) {
      const pattern = new RegExp(`(?:${k})\\s*[:=-]?\\s*([^\\n,]+)`, 'i');
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  };

  const projectName = getVal(['project', 'name', 'check list', 'project name']) || 'Unknown';
  const url = getVal(['url', 'link', 'website link']) || null;
  const packageName = getVal(['package', 'package name']) || null;
  const domainProvider = getVal(['domain provider', 'domain']) || null;
  const hostingProvider = getVal(['hosting provider', 'hosting']) || null;
  const hostingRemark = getVal(['hosting remark', 'hosting note']) || null;
  const domainExpireDateStr = getVal(['domain expire', 'domain expiration', 'domain expiry', 'domain date']);
  const hostingExpireDateStr = getVal(['hosting expire', 'hosting expiration', 'hosting expiry', 'hosting date']);
  const remark = getVal(['remark', 'remarks', 'note', 'notes']) || null;

  let domainExpireDate: Date | null = null;
  if (domainExpireDateStr) {
    const p = Date.parse(domainExpireDateStr);
    if (!isNaN(p)) domainExpireDate = new Date(p);
  }

  let hostingExpireDate: Date | null = null;
  if (hostingExpireDateStr) {
    const p = Date.parse(hostingExpireDateStr);
    if (!isNaN(p)) hostingExpireDate = new Date(p);
  }

  return {
    projectName,
    url,
    packageName,
    domainProvider,
    hostingProvider,
    hostingRemark,
    domainExpireDate,
    hostingExpireDate,
    remark,
  };
}

export async function parseWebsiteUpdateMessageWithGemini({
  text,
  apiKey,
  model,
}: {
  text: string;
  apiKey?: string | null;
  model?: string | null;
}): Promise<ParsedWebsiteUpdate & { status: string; remark: string | null }> {
  const fallback = parseWebsiteUpdateMessage(text);
  if (!apiKey) return fallback;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-3.1-flash-lite-preview';
    const prompt = `You are a website update/maintenance data extractor. Extract structured data from this message.
Message:
"""${text}"""

Extract and return a JSON object with these fields:
{
  "name": string (required, name of the project / client website),
  "url": string | null (website link/URL),
  "businessType": string | null (business type / description),
  "packageName": string | null (package name),
  "status": "up_to_date" | "pending_update" | "in_progress" (maintenance status, default is "up_to_date"),
  "remark": string | null (remarks / update logs / notes)
}

Rules:
- If a field is not mentioned, set it to null.
- Return ONLY valid JSON, no explanation.`;

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: prompt,
    });

    const responseText = response?.text;
    if (!responseText) return fallback;

    const cleanedJson = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const parsed = JSON.parse(cleanedJson);

    return {
      name: parsed.name || fallback.name,
      url: parsed.url || fallback.url,
      businessType: parsed.businessType || fallback.businessType,
      packageName: parsed.packageName || fallback.packageName,
      status: parsed.status || fallback.status,
      remark: parsed.remark || fallback.remark,
    };
  } catch (err) {
    console.error("Gemini website update text parse failed:", err);
    return fallback;
  }
}

export function parseWebsiteUpdateMessage(text: string): ParsedWebsiteUpdate & { status: string; remark: string | null } {
  const getVal = (keys: string[]) => {
    for (const k of keys) {
      const pattern = new RegExp(`(?:${k})\\s*[:=-]?\\s*([^\\n,]+)`, 'i');
      const match = text.match(pattern);
      if (match) return match[1].trim();
    }
    return null;
  };

  const name = getVal(['name', 'project name', 'project']) || 'Unknown';
  const url = getVal(['url', 'link', 'website link', 'website']) || null;
  const businessType = getVal(['business type', 'business', 'business_type']) || null;
  const packageName = getVal(['package', 'package name']) || null;
  const statusVal = getVal(['status', 'update status']) || 'up_to_date';
  const remark = getVal(['remark', 'remarks', 'note', 'notes']) || null;

  let status = 'up_to_date';
  if (statusVal) {
    const lower = statusVal.toLowerCase().replace(/[\s_]/g, '');
    if (lower.includes('progress') || lower.includes('inprog')) {
      status = 'in_progress';
    } else if (lower.includes('pending') || lower.includes('pend')) {
      status = 'pending_update';
    }
  }

  return {
    name,
    url,
    businessType,
    packageName,
    status,
    remark,
  };
}
// ─── Business Report Parser ──────────────────────────────────────────────────

export type ParsedBusinessReport = {
  reportDate: Date;
  reporterName: string | null;
  marketingBudget: number | null;
  marketingChannel: string | null;
  callsMade: number | null;
  appointmentsMade: number | null;
  appointmentsKept: number | null;
  newLeads: number | null;
  totalDemandCount: number | null;
  totalSalesAmount: number | null;
  closedDeals: number | null;
  pendingDeals: number | null;
  notes: string | null;
  targetDemandCount: number | null;
  targetAppointments: number | null;
  targetSalesAmount: number | null;
};

const BUSINESS_REPORT_HEADERS = [
  'marketing budget',
  'calls made',
  'appointments made',
  'closed deals',
  'total sales',
  'new leads',
];

export function isBusinessReportHeaders(headers: unknown[]): boolean {
  const normalized = headers.map(h => String(h || '').toLowerCase().trim());
  const matched = BUSINESS_REPORT_HEADERS.filter(h =>
    normalized.some(n => n.includes(h))
  );
  return matched.length >= 3;
}

export function parseBusinessReportSpreadsheet(buffer: Buffer): ParsedBusinessReport[] {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const results: ParsedBusinessReport[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);

    for (const row of rows) {
      const getStr = (keys: string[]) => {
        for (const k of keys) {
          const key = Object.keys(row).find(r => r.toLowerCase().includes(k));
          if (key && row[key] != null && String(row[key]).trim()) return String(row[key]).trim();
        }
        return null;
      };
      const getNum = (keys: string[]) => {
        const v = getStr(keys);
        if (!v) return null;
        const n = parseFloat(convertBurmeseDigits(v).replace(/,/g, ''));
        return isNaN(n) ? null : n;
      };
      const getInt = (keys: string[]) => {
        const n = getNum(keys);
        return n !== null ? Math.round(n) : null;
      };

      const dateStr = getStr(['date', 'report date']);
      let reportDate = new Date();
      if (dateStr) {
        const parsed = Date.parse(dateStr);
        if (!isNaN(parsed)) reportDate = new Date(parsed);
      }

      results.push({
        reportDate,
        reporterName: getStr(['reporter', 'staff', 'name', 'agent']),
        marketingBudget: getNum(['marketing budget', 'budget', 'ad spend', 'ad cost']),
        marketingChannel: getStr(['marketing channel', 'channel', 'platform', 'source']),
        callsMade: getInt(['calls made', 'calls', 'call']),
        appointmentsMade: getInt(['appointments made', 'appt made', 'appointments']),
        appointmentsKept: getInt(['appointments kept', 'appt kept', 'kept']),
        newLeads: getInt(['new leads', 'leads']),
        totalDemandCount: getInt(['total demand', 'demand count', 'demand']),
        totalSalesAmount: getNum(['total sales amount', 'total sales', 'sales amount', 'revenue']),
        closedDeals: getInt(['closed deals', 'closed', 'deals closed']),
        pendingDeals: getInt(['pending deals', 'pending', 'pipeline']),
        notes: getStr(['notes', 'note', 'remarks', 'remark', 'comment']),
        targetDemandCount: null,
        targetAppointments: null,
        targetSalesAmount: null,
      });
    }
  }

  return results.filter(r => r.reportDate);
}

export function parseBusinessReportMessage(text: string): ParsedBusinessReport {
  const getVal = (keys: string[]) => {
    for (const k of keys) {
      const p = new RegExp(`(?:${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})\\s*[:=-]?\\s*((?:[^\n,]|,(?=\\d))+)`, 'i');
      const m = convertBurmeseDigits(text).match(p);
      if (m) return m[1].trim();
    }
    return null;
  };
  const getNum = (keys: string[]) => {
    const v = getVal(keys);
    if (!v) return null;
    const n = parseFloat(v.replace(/,/g, ''));
    return isNaN(n) ? null : n;
  };
  const getInt = (keys: string[]) => {
    const n = getNum(keys);
    return n !== null ? Math.round(n) : null;
  };

  const dateStr = getVal(['date', 'report date', 'ရက်']);
  let reportDate = new Date();
  if (dateStr) {
    const parsed = Date.parse(dateStr);
    if (!isNaN(parsed)) reportDate = new Date(parsed);
  } else {
    // Standalone date pattern search fallback, e.g. "11.June.2026" or "11-June-2026"
    const datePattern = /(\d{1,2})[\s./-](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s./-](\d{4})/i;
    const match = text.match(datePattern);
    if (match) {
      const day = match[1];
      const month = match[2];
      const year = match[3];
      const parsed = Date.parse(`${day} ${month} ${year}`);
      if (!isNaN(parsed)) reportDate = new Date(parsed);
    } else {
      const digitDatePattern = /(\d{1,2})[\s./-](\d{1,2})[\s./-](\d{4})/;
      const matchDigits = text.match(digitDatePattern);
      if (matchDigits) {
        const day = parseInt(matchDigits[1]);
        const month = parseInt(matchDigits[2]);
        const year = parseInt(matchDigits[3]);
        const d = new Date(year, month - 1, day);
        if (!isNaN(d.getTime())) reportDate = d;
      }
    }
  }

  return {
    reportDate,
    reporterName: getVal(['reporter', 'reported by', 'staff', 'name']) || null,
    marketingBudget: getNum(['marketing budget', 'budget', 'ad spend', 'ad cost', 'ကြော်ငြာ']),
    marketingChannel: getVal(['channel', 'marketing channel', 'platform', 'source']),
    callsMade: getInt(['calls made', 'ph call', 'calls', 'call', 'ဖုန်းခေါ်']),
    appointmentsMade: getInt(['appointments made', 'appointment', 'appt made', 'appointments', 'ချိန်းဆိုမှု']),
    appointmentsKept: getInt(['appointments kept', 'appt kept', 'kept', 'ဆုံတွေ့']),
    newLeads: getInt(['new leads', 'potential', 'leads', 'lead', 'lead count', 'customer count', 'ဖောက်သည်']),
    totalDemandCount: getInt(['total demand', 'messages', 'demand count', 'demand', 'total demand count']),
    totalSalesAmount: getNum(['total income', 'total sales amount', 'total sales', 'sales amount', 'sales', 'revenue', 'ရောင်းရငွေ']),
    closedDeals: getInt(['closed deals', 'closed', 'deals closed', 'deal closed']),
    pendingDeals: getInt(['pending deals', 'need to follow up', 'pending', 'pipeline']),
    notes: getVal(['notes', 'note', 'remarks', 'remark', 'မှတ်ချက်']) || text.trim() || null,
    targetDemandCount: getInt(['target demand messages', 'target demand', 'target messages']),
    targetAppointments: getInt(['target appointment', 'target appointments', 'appointment target']),
    targetSalesAmount: getNum(['sale target', 'sales target', 'target sales', 'target income', 'target revenue']),
  };
}

export async function parseBusinessReportWithGemini({
  text,
  apiKey,
  model,
}: {
  text: string;
  apiKey?: string | null;
  model?: string | null;
}): Promise<ParsedBusinessReport> {
  const fallback = parseBusinessReportMessage(text);
  if (!apiKey) return fallback;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-3.1-flash-lite-preview';

    const prompt = `You are a business activity report extractor. Extract structured data from this daily/weekly report message.
The message may be in Burmese (Myanmar), English, or mixed.

Message:
"""${text}"""

Extract and return a JSON object with these fields:
{
  "reportDate": string | null (date this report covers, YYYY-MM-DD format),
  "reporterName": string | null (person who wrote the report),
  "marketingBudget": number | null (ad spend / marketing cost in Ks),
  "marketingChannel": string | null (Facebook | Google | Referral | Walk-in | Telegram | Other),
  "callsMade": number | null (number of calls made),
  "appointmentsMade": number | null (appointments scheduled),
  "appointmentsKept": number | null (appointments that actually happened),
  "newLeads": number | null (new potential customers found),
  "totalDemandCount": number | null (total demand records / sales requests),
  "totalSalesAmount": number | null (total revenue / sales amount in Ks),
  "closedDeals": number | null (deals confirmed / closed),
  "pendingDeals": number | null (deals still pending),
  "notes": string | null (any other remarks or observations),
  "targetDemandCount": number | null (target demand messages count),
  "targetAppointments": number | null (target appointments count),
  "targetSalesAmount": number | null (target sales/revenue amount in Ks)
}

Rules:
- Extract numbers even if written in Burmese digits.
- If a field is not mentioned, set it to null.
- Return ONLY valid JSON, no explanation.`;

    const response = await generateContentWithRetry(genAI, { model: modelName, contents: prompt });
    const responseText = response?.text;
    if (!responseText) return fallback;

    const cleanedJson = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleanedJson);

    let reportDate = fallback.reportDate;
    if (parsed.reportDate) {
      const d = Date.parse(parsed.reportDate);
      if (!isNaN(d)) reportDate = new Date(d);
    }

    return {
      reportDate,
      reporterName: parsed.reporterName || fallback.reporterName,
      marketingBudget: typeof parsed.marketingBudget === 'number' ? parsed.marketingBudget : fallback.marketingBudget,
      marketingChannel: parsed.marketingChannel || fallback.marketingChannel,
      callsMade: typeof parsed.callsMade === 'number' ? Math.round(parsed.callsMade) : fallback.callsMade,
      appointmentsMade: typeof parsed.appointmentsMade === 'number' ? Math.round(parsed.appointmentsMade) : fallback.appointmentsMade,
      appointmentsKept: typeof parsed.appointmentsKept === 'number' ? Math.round(parsed.appointmentsKept) : fallback.appointmentsKept,
      newLeads: typeof parsed.newLeads === 'number' ? Math.round(parsed.newLeads) : fallback.newLeads,
      totalDemandCount: typeof parsed.totalDemandCount === 'number' ? Math.round(parsed.totalDemandCount) : fallback.totalDemandCount,
      totalSalesAmount: typeof parsed.totalSalesAmount === 'number' ? parsed.totalSalesAmount : fallback.totalSalesAmount,
      closedDeals: typeof parsed.closedDeals === 'number' ? Math.round(parsed.closedDeals) : fallback.closedDeals,
      pendingDeals: typeof parsed.pendingDeals === 'number' ? Math.round(parsed.pendingDeals) : fallback.pendingDeals,
      notes: parsed.notes || fallback.notes,
      targetDemandCount: typeof parsed.targetDemandCount === 'number' ? Math.round(parsed.targetDemandCount) : fallback.targetDemandCount,
      targetAppointments: typeof parsed.targetAppointments === 'number' ? Math.round(parsed.targetAppointments) : fallback.targetAppointments,
      targetSalesAmount: typeof parsed.targetSalesAmount === 'number' ? parsed.targetSalesAmount : fallback.targetSalesAmount,
    };
  } catch (err) {
    console.error('Gemini business report parse failed, using heuristic fallback:', err);
    return fallback;
  }
}
