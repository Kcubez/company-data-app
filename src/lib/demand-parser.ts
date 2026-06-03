import { GoogleGenAI } from "@google/genai";
import * as XLSX from "xlsx";

export const REPORT_TYPES = {
  BUSINESS_REPORT: "business_report",
  FUTURE_PLAN: "future_plan",
  QA: "qa",
} as const;

export type ReportType = (typeof REPORT_TYPES)[keyof typeof REPORT_TYPES];

export function isReportType(value: string | null | undefined): value is ReportType {
  return (
    value === REPORT_TYPES.BUSINESS_REPORT ||
    value === REPORT_TYPES.FUTURE_PLAN ||
    value === REPORT_TYPES.QA
  );
}

export type ParsedDemandRecord = {
  reportType: ReportType;
  customerName: string | null;
  category: string;
  status: string;
  note: string;
  confidence: number;
  aiProvider: string;
  aiModel: string | null;
  followUpDate: Date | null;
  // Business Report fields
  totalSales: number | null;
  demand: number | null;
  serviceName: string | null;
  serviceAmount: number | null;
  serviceQty: number | null;
  appointments: number | null;
  projectName: string | null;
  projectStatus: string | null;
  marketingBudget: number | null;
  // Future Plan fields
  followUpClient: string | null;
  followUpReason: string | null;
  focusService: string | null;
  focusReason: string | null;
  delayedProject: string | null;
  delayReason: string | null;
  nextSteps: string | null;
  // Legacy
  quantity: number | null;
  product: string | null;
  amount: number | null;
  unit: string | null;
};

async function generateContentWithRetry(
  genAI: any,
  options: { model: string; contents: string | any[] },
  maxRetries = 3,
  delayMs = 1500
): Promise<any> {
  let lastError: any = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await genAI.models.generateContent(options);
      return response;
    } catch (err: any) {
      lastError = err;
      const status = err.status || err.statusCode;
      const errStr = typeof err === 'object' ? JSON.stringify(err) : String(err);
      
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
        console.warn(`Gemini API returned retryable error (attempt ${i + 1}/${maxRetries}):`, err.message || err);
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

function parseBusinessReport(text: string): Partial<ParsedDemandRecord> {
  const totalSales = extractNumber(text, [
    /(?:total\s*sales?|sales?)\s*[:=-]?\s*([\d,]+\.?\d*)/i,
  ]);

  const demand = extractNumber(text, [
    /(?:demand)\s*[:=-]?\s*([\d,]+\.?\d*)/i,
  ]);

  const serviceName = extractString(text, [
    /(?:service)\s*[:=-]?\s*([^\n,\-]+?)(?:\s*[-:]|\s+amount|\s+qty|$)/i,
  ]);

  const serviceAmount = extractNumber(text, [
    /(?:service.*?amount)\s*[:=-]?\s*([\d,]+\.?\d*)/i,
    /(?:amount)\s*[:=-]?\s*([\d,]+\.?\d*)/i,
  ]);

  const serviceQty = extractNumber(text, [
    /(?:service.*?qty|service.*?quantity|qty)\s*[:=-]?\s*([\d,]+)/i,
  ]);

  const appointments = extractNumber(text, [
    /(?:appointments?)\s*[:=-]?\s*([\d,]+)/i,
    /([\d,]+)\s*(?:appointments?)/i,
  ]);

  const projectName = extractString(text, [
    /(?:project)\s*[:=-]?\s*([^\n,\-]+?)(?:\s*[-:]|\s+status|$)/i,
  ]);

  const projectStatus = extractString(text, [
    /(?:status)\s*[:=-]?\s*(on.?track|delayed|completed|at.?risk)/i,
  ]);

  const marketingBudget = extractNumber(text, [
    /(?:marketing\s*budget|marketing)\s*[:=-]?\s*([\d,]+\.?\d*)/i,
  ]);

  return {
    totalSales,
    demand,
    serviceName: serviceName ? cleanValue(serviceName) : null,
    serviceAmount,
    serviceQty: serviceQty ? Math.round(serviceQty) : null,
    appointments: appointments ? Math.round(appointments) : null,
    projectName: projectName ? cleanValue(projectName) : null,
    projectStatus: projectStatus ? cleanValue(projectStatus).toLowerCase().replace(/\s+/g, '_') : null,
    marketingBudget,
  };
}

function parseFuturePlan(text: string): Partial<ParsedDemandRecord> {
  const followUpClient = extractString(text, [
    /(?:follow[\s-]?up)\s*[:=-]?\s*([^\n,\-]+?)(?:\s*[-:]|\s+reason|$)/i,
    /(?:client|customer)\s*[:=-]?\s*([^\n,]+)/i,
  ]);

  const followUpReason = extractString(text, [
    /(?:follow[\s-]?up.*?reason)\s*[:=-]?\s*([^\n]+)/i,
  ]);

  const focusService = extractString(text, [
    /(?:focus\s*service|focus)\s*[:=-]?\s*([^\n,\-]+?)(?:\s*[-:]|\s+reason|$)/i,
  ]);

  const focusReason = extractString(text, [
    /(?:focus.*?reason)\s*[:=-]?\s*([^\n]+)/i,
  ]);

  const delayedProject = extractString(text, [
    /(?:delayed?\s*project|delayed?)\s*[:=-]?\s*([^\n,\-]+?)(?:\s*[-:]|\s+reason|$)/i,
  ]);

  const delayReason = extractString(text, [
    /(?:delay.*?reason)\s*[:=-]?\s*([^\n]+)/i,
  ]);

  const nextSteps = extractString(text, [
    /(?:next\s*steps?)\s*[:=-]?\s*([^\n]+)/i,
  ]);

  return {
    followUpClient: followUpClient ? cleanValue(followUpClient) : null,
    followUpReason: followUpReason ? cleanValue(followUpReason) : null,
    focusService: focusService ? cleanValue(focusService) : null,
    focusReason: focusReason ? cleanValue(focusReason) : null,
    delayedProject: delayedProject ? cleanValue(delayedProject) : null,
    delayReason: delayReason ? cleanValue(delayReason) : null,
    nextSteps: nextSteps ? cleanValue(nextSteps) : null,
  };
}

function parseDemandMessage(text: string, reportType: ReportType): ParsedDemandRecord {
  const baseRecord: ParsedDemandRecord = {
    reportType,
    customerName: null,
    category: 'general',
    status: 'new',
    note: text.trim(),
    confidence: 0.3,
    aiProvider: 'heuristic',
    aiModel: null,
    followUpDate: null,
    totalSales: null,
    demand: null,
    serviceName: null,
    serviceAmount: null,
    serviceQty: null,
    appointments: null,
    projectName: null,
    projectStatus: null,
    marketingBudget: null,
    followUpClient: null,
    followUpReason: null,
    focusService: null,
    focusReason: null,
    delayedProject: null,
    delayReason: null,
    nextSteps: null,
    quantity: null,
    product: null,
    amount: null,
    unit: null,
  };

  if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
    const extracted = parseBusinessReport(text);
    Object.assign(baseRecord, extracted);
    baseRecord.category = 'business';
    const fieldsFound = [extracted.totalSales, extracted.demand, extracted.serviceName, extracted.appointments, extracted.projectName, extracted.marketingBudget].filter(v => v !== null && v !== undefined).length;
    baseRecord.confidence = Math.min(0.3 + fieldsFound * 0.1, 0.8);
  } else if (reportType === REPORT_TYPES.FUTURE_PLAN) {
    const extracted = parseFuturePlan(text);
    Object.assign(baseRecord, extracted);
    baseRecord.category = 'planning';
    const fieldsFound = [extracted.followUpClient, extracted.focusService, extracted.delayedProject, extracted.nextSteps].filter(v => v !== null && v !== undefined).length;
    baseRecord.confidence = Math.min(0.3 + fieldsFound * 0.12, 0.8);
  }

  return baseRecord;
}

function buildGeminiPrompt(text: string, reportType: ReportType): string {
  if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
    return `You are a business report data extractor. Extract structured data from this business report message.
The message may be in Burmese (Myanmar) or English or mixed.

Message:
"""${text}"""

Extract and return a JSON object with these fields:
{
  "note": string (clean summary of the report),
  "totalSales": number | null (total sales amount),
  "demand": number | null (demand count or amount),
  "serviceName": string | null (service/product name mentioned),
  "serviceAmount": number | null (revenue from the service),
  "serviceQty": number | null (quantity sold),
  "appointments": number | null (number of appointments),
  "projectName": string | null (project name),
  "projectStatus": "on_track" | "delayed" | "completed" | "at_risk" | null,
  "marketingBudget": number | null (marketing spend),
  "customerName": string | null (customer name if mentioned),
  "category": "sales" | "service" | "project" | "marketing" | "general",
  "status": "new" | "in_progress" | "completed"
}

Rules:
- Extract numbers even if written in Burmese digits.
- If a field is not mentioned, set it to null.
- For category, pick the most relevant one based on what the report is mainly about.
- Return ONLY valid JSON, no explanation.`;
  }

  return `You are a future planning data extractor. Extract structured data from this planning/follow-up message.
The message may be in Burmese (Myanmar) or English or mixed.

Message:
"""${text}"""

Extract and return a JSON object with these fields:
{
  "note": string (clean summary),
  "followUpClient": string | null (client who needs follow-up),
  "followUpReason": string | null (why follow-up is needed),
  "focusService": string | null (service to focus on),
  "focusReason": string | null (why to focus on this service),
  "delayedProject": string | null (project that is delayed),
  "delayReason": string | null (reason for delay),
  "nextSteps": string | null (what to do next),
  "customerName": string | null (customer name if mentioned),
  "category": "follow_up" | "focus" | "delay" | "planning" | "general",
  "status": "new" | "pending" | "in_progress"
}

Rules:
- Extract client/project/service names accurately.
- If a field is not mentioned, set it to null.
- Return ONLY valid JSON, no explanation.`;
}

export async function parseDemandMessageWithGemini({
  text,
  receivedAt,
  reportType,
  apiKey,
  model,
}: {
  text: string;
  receivedAt: Date;
  reportType: ReportType;
  apiKey?: string | null;
  model?: string | null;
}): Promise<ParsedDemandRecord> {
  const fallback = parseDemandMessage(text, reportType);

  if (!apiKey) return fallback;

  try {
    const genAI = new GoogleGenAI({ apiKey });
    const modelName = model || 'gemini-3.1-flash-lite-preview';
    const prompt = buildGeminiPrompt(text, reportType);

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

    if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
      return {
        ...fallback,
        aiProvider: 'gemini',
        aiModel: modelName,
        confidence: 0.9,
        note: typeof parsed.note === 'string' ? parsed.note : fallback.note,
        customerName: parsed.customerName || fallback.customerName,
        category: parsed.category || fallback.category,
        status: parsed.status || fallback.status,
        totalSales: typeof parsed.totalSales === 'number' ? parsed.totalSales : fallback.totalSales,
        demand: typeof parsed.demand === 'number' ? parsed.demand : fallback.demand,
        serviceName: parsed.serviceName || fallback.serviceName,
        serviceAmount: typeof parsed.serviceAmount === 'number' ? parsed.serviceAmount : fallback.serviceAmount,
        serviceQty: typeof parsed.serviceQty === 'number' ? parsed.serviceQty : fallback.serviceQty,
        appointments: typeof parsed.appointments === 'number' ? parsed.appointments : fallback.appointments,
        projectName: parsed.projectName || fallback.projectName,
        projectStatus: parsed.projectStatus || fallback.projectStatus,
        marketingBudget: typeof parsed.marketingBudget === 'number' ? parsed.marketingBudget : fallback.marketingBudget,
      };
    }

    // Future Plan
    return {
      ...fallback,
      aiProvider: 'gemini',
      aiModel: modelName,
      confidence: 0.9,
      note: typeof parsed.note === 'string' ? parsed.note : fallback.note,
      customerName: parsed.customerName || fallback.customerName,
      category: parsed.category || fallback.category,
      status: parsed.status || fallback.status,
      followUpClient: parsed.followUpClient || fallback.followUpClient,
      followUpReason: parsed.followUpReason || fallback.followUpReason,
      focusService: parsed.focusService || fallback.focusService,
      focusReason: parsed.focusReason || fallback.focusReason,
      delayedProject: parsed.delayedProject || fallback.delayedProject,
      delayReason: parsed.delayReason || fallback.delayReason,
      nextSteps: parsed.nextSteps || fallback.nextSteps,
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

// Gemini's inlineData does not accept xlsx/xls; parse them server-side and
// send the extracted text to the model instead.
const SPREADSHEET_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel', // .xls
  'application/vnd.ms-excel.sheet.macroEnabled.12', // .xlsm
]);

export function isSpreadsheetFile(mimeType: string, fileName: string): boolean {
  if (SPREADSHEET_MIME_TYPES.has(mimeType)) return true;
  // Some clients (e.g. Telegram) send spreadsheets as application/octet-stream.
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

function buildFileExtractionPrompt(reportType: ReportType, caption?: string): string {
  const captionNote = caption
    ? `\nThe user also provided this caption/context: "${caption}"\n`
    : '';

  if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
    return `You are a business report data extractor. Extract ALL text and data from the uploaded file.
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
    "note": string (clean summary of this entry),
    "totalSales": number | null,
    "demand": number | null,
    "serviceName": string | null,
    "serviceAmount": number | null,
    "serviceQty": number | null,
    "appointments": number | null,
    "projectName": string | null,
    "projectStatus": "on_track" | "delayed" | "completed" | "at_risk" | null,
    "marketingBudget": number | null,
    "customerName": string | null,
    "category": "sales" | "service" | "project" | "marketing" | "general",
    "status": "new" | "in_progress" | "completed"
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

  return `You are a future planning data extractor. Extract ALL text and data from the uploaded file.
The content may be in Burmese (Myanmar) or English or mixed.${captionNote}

The file may contain MANY rows / clients / plans. You MUST extract one structured record per logical entry — do NOT collapse multiple clients or rows into a single record. If the file is a single short note with only one follow-up, return a one-element array.

First, provide a complete text extraction of everything in the file.
Then, extract structured data and return a JSON ARRAY (one element per client/plan/follow-up).

Return your response in this exact format:

EXTRACTED_TEXT:
[All text content from the file goes here]

STRUCTURED_DATA:
\`\`\`json
[
  {
    "note": string (clean summary of this entry),
    "followUpClient": string | null,
    "followUpReason": string | null,
    "focusService": string | null,
    "focusReason": string | null,
    "delayedProject": string | null,
    "delayReason": string | null,
    "nextSteps": string | null,
    "customerName": string | null,
    "category": "follow_up" | "focus" | "delay" | "planning" | "general",
    "status": "new" | "pending" | "in_progress"
  }
]
\`\`\`

Rules:
- Return a JSON ARRAY, not a single object.
- Create one array element per client / row / plan in the file. If the file has 30 follow-ups, return 30 (or more) elements.
- Extract ALL text content from the file into EXTRACTED_TEXT, even if it doesn't fit the structured fields.
- If a structured field is not found for an entry, set it to null.
- Return BOTH the extracted text AND the JSON array.`;
}

function parseFileExtractionResponse(
  responseText: string,
  reportType: ReportType,
): { extractedText: string; records: Record<string, unknown>[] } {
  let extractedText = responseText;
  let records: Record<string, unknown>[] = [];

  // Try to split EXTRACTED_TEXT and STRUCTURED_DATA sections
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
        // Model returned a single object — wrap it as a one-element array so the
        // downstream loop still creates one record.
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
  reportType: ReportType,
  modelName: string,
): ParsedDemandRecord {
  const fallback = parseDemandMessage(
    (structuredData.note as string) || extractedText.slice(0, 500),
    reportType,
  );

  const parsed: ParsedDemandRecord = {
    ...fallback,
    aiProvider: 'gemini',
    aiModel: modelName,
    confidence: 0.85,
    note: (structuredData.note as string) || extractedText.slice(0, 500),
    customerName: (structuredData.customerName as string) || null,
    category: (structuredData.category as string) || fallback.category,
    status: (structuredData.status as string) || fallback.status,
  };

  if (reportType === REPORT_TYPES.BUSINESS_REPORT) {
    parsed.totalSales = typeof structuredData.totalSales === 'number' ? structuredData.totalSales : null;
    parsed.demand = typeof structuredData.demand === 'number' ? structuredData.demand : null;
    parsed.serviceName = (structuredData.serviceName as string) || null;
    parsed.serviceAmount = typeof structuredData.serviceAmount === 'number' ? structuredData.serviceAmount : null;
    parsed.serviceQty = typeof structuredData.serviceQty === 'number' ? structuredData.serviceQty : null;
    parsed.appointments = typeof structuredData.appointments === 'number' ? structuredData.appointments : null;
    parsed.projectName = (structuredData.projectName as string) || null;
    parsed.projectStatus = (structuredData.projectStatus as string) || null;
    parsed.marketingBudget = typeof structuredData.marketingBudget === 'number' ? structuredData.marketingBudget : null;
  } else {
    parsed.followUpClient = (structuredData.followUpClient as string) || null;
    parsed.followUpReason = (structuredData.followUpReason as string) || null;
    parsed.focusService = (structuredData.focusService as string) || null;
    parsed.focusReason = (structuredData.focusReason as string) || null;
    parsed.delayedProject = (structuredData.delayedProject as string) || null;
    parsed.delayReason = (structuredData.delayReason as string) || null;
    parsed.nextSteps = (structuredData.nextSteps as string) || null;
  }

  return parsed;
}

export async function extractDataFromFile({
  fileBuffer,
  mimeType,
  fileName,
  reportType,
  caption,
  apiKey,
  model,
  onProgress,
}: {
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
  reportType: ReportType;
  caption?: string;
  apiKey: string;
  model?: string | null;
  onProgress?: (current: number, total: number, errorMsg?: string) => Promise<void> | void;
}): Promise<{ extractedText: string; parsed: ParsedDemandRecord[] }> {
  const genAI = new GoogleGenAI({ apiKey });
  const modelName = model || 'gemini-3.1-flash-lite-preview';
  const prompt = buildFileExtractionPrompt(reportType, caption);

  // For text-based files, read content directly and send as text
  const isTextFile = TEXT_MIME_TYPES.has(mimeType);
  const isSpreadsheet = isSpreadsheetFile(mimeType, fileName);

  if (isSpreadsheet) {
    try {
      const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
      const allExtractedTexts: string[] = [];
      const allParsedRecords: ParsedDemandRecord[] = [];
      const batchSize = 5;

      // Calculate total chunks first
      let totalChunks = 0;
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        if (rows.length === 0) continue;
        const dataRows = rows.slice(1);
        if (dataRows.length <= batchSize) {
          totalChunks += 1;
        } else {
          totalChunks += Math.ceil(dataRows.length / batchSize);
        }
      }

      let processedChunks = 0;

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });
        if (rows.length === 0) continue;

        const headerRow = rows[0];
        const dataRows = rows.slice(1);

        // If sheet is small, process in one call to save API calls
        if (dataRows.length <= batchSize) {
          processedChunks++;
          const csv = XLSX.utils.sheet_to_csv(sheet);
          if (!csv.trim()) {
            if (onProgress) {
              await onProgress(processedChunks, totalChunks);
            }
            continue;
          }

          const textContent = `=== Sheet: ${sheetName} ===\n${csv}`;
          const fullPrompt = `${prompt}\n\nFile name: ${fileName}\nFile content:\n"""\n${textContent}\n"""`;

          try {
            const response = await generateContentWithRetry(genAI, {
              model: modelName,
              contents: fullPrompt,
            });
            const resText = response?.text || '';
            if (resText) {
              const { extractedText, records } = parseFileExtractionResponse(resText, reportType);
              allExtractedTexts.push(extractedText);
              records.forEach((structuredData) => {
                allParsedRecords.push(buildRecordFromStructuredData(structuredData, extractedText, reportType, modelName));
              });
            }
            if (onProgress) {
              await onProgress(processedChunks, totalChunks);
            }
          } catch (err: any) {
            console.error(`Error processing sheet ${sheetName}:`, err);
            if (onProgress) {
              await onProgress(processedChunks, totalChunks, `Sheet '${sheetName}' error: ${err.message || err}`);
            }
          }
        } else {
          // Chunk data rows in groups of batchSize
          const chunkSize = batchSize;
          const chunks: any[][][] = [];
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
            const fullPrompt = `${prompt}\n\nFile name: ${fileName}\nFile content:\n"""\n${textContent}\n"""`;

            try {
              // Add a 1-second delay between chunks to prevent Gemini Rate Limit (RPM)
              if (idx > 0) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
              }

              const response = await generateContentWithRetry(genAI, {
                model: modelName,
                contents: fullPrompt,
              });
              const resText = response?.text || '';
              if (resText) {
                const { extractedText, records } = parseFileExtractionResponse(resText, reportType);
                allExtractedTexts.push(extractedText);
                records.forEach((structuredData) => {
                  allParsedRecords.push(buildRecordFromStructuredData(structuredData, extractedText, reportType, modelName));
                });
              }
              if (onProgress) {
                await onProgress(processedChunks, totalChunks);
              }
            } catch (chunkErr: any) {
              console.error(`Error processing chunk ${idx + 1} of sheet ${sheetName}:`, chunkErr);
              if (onProgress) {
                await onProgress(processedChunks, totalChunks, `Sheet '${sheetName}' chunk ${idx + 1} error: ${chunkErr.message || chunkErr}`);
              }
            }
          }
        }
      }

      return {
        extractedText: allExtractedTexts.join('\n\n') || `[Spreadsheet: ${fileName}] - Extracted content`,
        parsed: allParsedRecords.length > 0 ? allParsedRecords : [
          {
            ...parseDemandMessage(`File processed: ${fileName}`, reportType),
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
    // Binary files: send as inlineData (multimodal)
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
    // Return a minimal fallback as a one-element array.
    return {
      extractedText: `[File: ${fileName}] - Could not extract content`,
      parsed: [
        {
          ...parseDemandMessage(`File uploaded: ${fileName}`, reportType),
          aiProvider: 'gemini',
          aiModel: modelName,
          confidence: 0.1,
        },
      ],
    };
  }

  const { extractedText, records } = parseFileExtractionResponse(responseText, reportType);

  // If the model returned no parseable records, fall back to a single heuristic
  // record from the extracted text so the user still sees something.
  if (records.length === 0) {
    return {
      extractedText,
      parsed: [
        {
          ...parseDemandMessage(extractedText.slice(0, 500), reportType),
          aiProvider: 'gemini',
          aiModel: modelName,
          confidence: 0.3,
        },
      ],
    };
  }

  const parsed = records.map((structuredData) =>
    buildRecordFromStructuredData(structuredData, extractedText, reportType, modelName),
  );

  return { extractedText, parsed };
}
