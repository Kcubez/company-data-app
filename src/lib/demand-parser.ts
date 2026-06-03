import { GoogleGenAI } from "@google/genai";

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
    const modelName = model || 'gemini-3.5-flash';
    const prompt = buildGeminiPrompt(text, reportType);

    const response = await genAI.models.generateContent({
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
    const modelName = model || 'gemini-3.5-flash';

    const prompt = `You are a helpful business assistant. Answer the user's question based on the business data context provided below.
Answer in the same language the user asked in (Burmese or English).
Be concise but helpful. If the data doesn't contain enough info, say so honestly.

=== BUSINESS DATA CONTEXT ===
${context}
=== END CONTEXT ===

User's question: ${question}

Answer:`;

    const response = await genAI.models.generateContent({
      model: modelName,
      contents: prompt,
    });

    return response?.text || 'Sorry, I could not generate an answer.';
  } catch (error) {
    console.error('Gemini Q&A failed:', error);
    return 'Sorry, AI service is currently unavailable. Please try again later.';
  }
}
