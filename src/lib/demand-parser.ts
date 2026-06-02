export type ParsedDemandRecord = {
  reportType: ReportType;
  customerName: string | null;
  category: string;
  status: string;
  note: string;
  followUpDate: Date | null;
  confidence: number;
  aiProvider: string;
  aiModel: string | null;
};

export type ReportType = "daily_report" | "customer_follow_up";

export const REPORT_TYPES = {
  DAILY_REPORT: "daily_report",
  CUSTOMER_FOLLOW_UP: "customer_follow_up",
} as const satisfies Record<string, ReportType>;

export function isReportType(value: unknown): value is ReportType {
  return value === REPORT_TYPES.DAILY_REPORT || value === REPORT_TYPES.CUSTOMER_FOLLOW_UP;
}

const CUSTOMER_PATTERNS = [
  /\bcustomer\s*[:=-]\s*([^\n,]+)/i,
  /\bclient\s*[:=-]\s*([^\n,]+)/i,
  /(?:customer|client)\s+([^\n,]+?)\s+(?:ကို|for|follow|called|sent)/i,
  /([^\n,]+?)\s+(?:customer|client)\b/i,
  /([^\n,]+?)\s*ကို\s*(?:follow|ဆက်|ဖုန်း|quotation|quote|ဈေး|စျေး)/i,
];

const STATUS_RULES: Array<[string, RegExp]> = [
  ["closed", /\b(closed|done|completed|won)\b|ပြီးပြီ|ရပြီ/i],
  ["pending", /\b(pending|waiting|hold|စောင့်|စောင့်)\b/i],
  ["quoted", /\b(quote|quotation|proposal|price)\b|ဈေး|စျေး|quotation ပို့/i],
  ["contacted", /\b(called|contacted|followed up|follow up|follow-up|messaged)\b|ဆက်သွယ်|ဖုန်း|follow/i],
  ["new", /\b(new|lead|inquiry)\b|စုံစမ်း/i],
];

const CATEGORY_RULES: Array<[string, RegExp]> = [
  ["follow_up", /\b(follow up|follow-up|followed up|callback|call back)\b|ပြန်ဆက်|ဆက်သွယ်/i],
  ["quotation", /\b(quote|quotation|proposal|price)\b|ဈေး|စျေး/i],
  ["demand", /\b(demand|need|request|order|want|require)\b|လိုချင်|မှာထား|တောင်း/i],
  ["complaint", /\b(complaint|issue|problem|error)\b|ပြဿနာ|အဆင်မပြေ/i],
  ["report", /\b(report|daily|update)\b|အစီရင်ခံ|နေ့စဉ်/i],
];

function cleanValue(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/[။.,;:]+$/g, "")
    .trim();
}

function extractCustomerName(text: string) {
  for (const pattern of CUSTOMER_PATTERNS) {
    const match = text.match(pattern);
    const value = match?.[1] ? cleanValue(match[1]) : "";
    if (value && value.length <= 80) {
      return value;
    }
  }

  return null;
}

function classifyFromRules(text: string, rules: Array<[string, RegExp]>, fallback: string) {
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? fallback;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function extractFollowUpDate(text: string, receivedAt: Date) {
  if (/\b(tomorrow|tmr)\b|မနက်ဖြန်/i.test(text)) {
    return addDays(startOfDay(receivedAt), 1);
  }

  if (/\b(today)\b|ဒီနေ့/i.test(text)) {
    return startOfDay(receivedAt);
  }

  if (/\b(next week)\b|နောက်အပတ်/i.test(text)) {
    return addDays(startOfDay(receivedAt), 7);
  }

  const isoDate = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (isoDate) {
    return new Date(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]));
  }

  const shortDate = text.match(/\b(\d{1,2})[-/](\d{1,2})(?:[-/](\d{2,4}))?\b/);
  if (shortDate) {
    const year = shortDate[3]
      ? Number(shortDate[3].length === 2 ? `20${shortDate[3]}` : shortDate[3])
      : receivedAt.getFullYear();
    return new Date(year, Number(shortDate[2]) - 1, Number(shortDate[1]));
  }

  return null;
}

export function parseDemandMessage(
  text: string,
  receivedAt = new Date(),
  reportType: ReportType = REPORT_TYPES.CUSTOMER_FOLLOW_UP
): ParsedDemandRecord {
  const customerName =
    reportType === REPORT_TYPES.CUSTOMER_FOLLOW_UP ? extractCustomerName(text) : null;
  const category =
    reportType === REPORT_TYPES.DAILY_REPORT
      ? "report"
      : classifyFromRules(text, CATEGORY_RULES, "general");
  const status = classifyFromRules(text, STATUS_RULES, "new");
  const followUpDate =
    reportType === REPORT_TYPES.CUSTOMER_FOLLOW_UP ? extractFollowUpDate(text, receivedAt) : null;

  let confidence = 0.35;
  if (customerName) confidence += 0.25;
  if (category !== "general") confidence += 0.2;
  if (status !== "new") confidence += 0.1;
  if (followUpDate) confidence += 0.1;

  return {
    reportType,
    customerName,
    category,
    status,
    note: text.trim(),
    followUpDate,
    confidence: Math.min(confidence, 0.95),
    aiProvider: "heuristic",
    aiModel: null,
  };
}

function buildGeminiPrompt(text: string, receivedAt: Date, reportType: ReportType) {
  const categoryGuidance =
    reportType === REPORT_TYPES.DAILY_REPORT
      ? "- This is an employee daily report/progress update. Summarize completed work, blockers, and progress in note. Use category \"report\" unless it is clearly a complaint.\n- customerName should be null unless a specific customer is central to the update."
      : "- This is a customer follow-up note. Extract customerName, customer request/pending items, and next follow-up date when present.";

  return `Extract one structured demand-sheet record from this Telegram employee report.

Return JSON only with this exact shape:
{
  "reportType": "${reportType}",
  "customerName": string | null,
  "category": "follow_up" | "quotation" | "demand" | "complaint" | "report" | "general",
  "status": "new" | "contacted" | "quoted" | "pending" | "closed",
  "note": string,
  "followUpDate": string | null,
  "confidence": number
}

Rules:
- The report can be Burmese, English, or mixed.
- ${categoryGuidance}
- Keep note as a concise cleaned version of the original message.
- followUpDate must be YYYY-MM-DD if a date is implied, otherwise null.
- Use received date ${receivedAt.toISOString().slice(0, 10)} for relative dates like today/tomorrow/next week.
- confidence must be between 0 and 1.

Telegram report:
${text}`;
}

function parseJsonObject(value: string) {
  const trimmed = value.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

function parseDateValue(value: unknown) {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function parseDemandMessageWithGemini({
  text,
  receivedAt = new Date(),
  reportType = REPORT_TYPES.CUSTOMER_FOLLOW_UP,
  apiKey,
  model = "gemini-3.5-flash",
}: {
  text: string;
  receivedAt?: Date;
  reportType?: ReportType;
  apiKey?: string | null;
  model?: string | null;
}): Promise<ParsedDemandRecord> {
  if (!apiKey) return parseDemandMessage(text, receivedAt, reportType);

  const fallback = parseDemandMessage(text, receivedAt, reportType);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model || "gemini-3.5-flash"}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: buildGeminiPrompt(text, receivedAt, reportType) }],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      throw new Error(`Gemini request failed: ${res.status}`);
    }

    const data = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof content !== "string") return fallback;

    const parsed = parseJsonObject(content);
    if (!parsed) return fallback;

    const confidence =
      typeof parsed.confidence === "number"
        ? Math.max(0, Math.min(1, parsed.confidence))
        : fallback.confidence;

    return {
      reportType,
      customerName:
        typeof parsed.customerName === "string" && parsed.customerName.trim()
          ? parsed.customerName.trim()
          : null,
      category: typeof parsed.category === "string" ? parsed.category : fallback.category,
      status: typeof parsed.status === "string" ? parsed.status : fallback.status,
      note: typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : text.trim(),
      followUpDate: parseDateValue(parsed.followUpDate),
      confidence,
      aiProvider: "gemini",
      aiModel: model || "gemini-3.5-flash",
    };
  } catch (error) {
    console.error("Gemini demand parsing failed:", error);
    return fallback;
  }
}
