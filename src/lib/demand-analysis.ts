import type { ParsedDemandRecord } from "@/lib/demand-parser";

export type DemandPriority = "high" | "medium" | "low";

export type DemandAnalysis = {
  priority: DemandPriority;
  potentialScore: number;
  priorityReason: string;
  recommendedAction: string;
  missingFields: string[];
  followUpStatus: "due" | "scheduled" | "overdue" | "not_scheduled";
};

type DemandAnalysisInput = Pick<
  ParsedDemandRecord,
  | "customerName"
  | "customerPhone"
  | "customerCompany"
  | "serviceName"
  | "serviceAmount"
  | "serviceQty"
  | "followUpDate"
  | "status"
  | "note"
  | "createdAt"
>;

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function getFollowUpStatus(followUpDate: Date | null | undefined): DemandAnalysis["followUpStatus"] {
  if (!followUpDate) return "not_scheduled";
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const date = new Date(followUpDate);

  if (isSameDay(date, today)) return "due";
  if (date < startOfToday) return "overdue";
  return "scheduled";
}

function hasDemandSignal(record: DemandAnalysisInput) {
  const text = `${record.serviceName || ""} ${record.note || ""}`.toLowerCase();
  return Boolean(
    record.serviceName ||
      text.includes("interested") ||
      text.includes("want") ||
      text.includes("need") ||
      text.includes("quote") ||
      text.includes("price") ||
      text.includes("demo") ||
      text.includes("hp") ||
      text.includes("potential"),
  );
}

export function analyzeDemandRecord(record: DemandAnalysisInput): DemandAnalysis {
  const missingFields: string[] = [];
  if (!record.customerName) missingFields.push("customerName");
  if (!record.customerPhone) missingFields.push("phone");
  if (!record.serviceName) missingFields.push("service");
  if (!record.followUpDate) missingFields.push("followUpDate");

  let score = 35;
  const reasons: string[] = [];
  const followUpStatus = getFollowUpStatus(record.followUpDate);
  const status = record.status || "new";
  const demandSignal = hasDemandSignal(record);

  if (record.customerName) score += 8;
  if (record.customerPhone) {
    score += 18;
    reasons.push("phone available");
  } else {
    score -= 14;
    reasons.push("phone missing");
  }

  if (record.customerCompany) score += 6;
  if (record.serviceName) {
    score += 14;
    reasons.push("service interest is clear");
  }
  if (record.serviceAmount && record.serviceAmount > 0) {
    score += 14;
    reasons.push("amount/revenue signal exists");
  }
  if (record.serviceQty && record.serviceQty > 0) score += 4;
  if (demandSignal) score += 10;

  if (followUpStatus === "due") {
    score += 12;
    reasons.push("follow-up due today");
  }
  if (followUpStatus === "overdue") {
    score += 10;
    reasons.push("follow-up overdue");
  }
  if (status === "closed" || status === "completed") score -= 28;
  if (status === "contacted" || status === "quoted" || status === "pending") score += 6;

  const potentialScore = Math.max(0, Math.min(100, Math.round(score)));
  const priority: DemandPriority =
    potentialScore >= 70 ? "high" : potentialScore >= 45 ? "medium" : "low";

  let recommendedAction = "Review the demand and schedule the next follow-up.";
  if (!record.customerPhone) {
    recommendedAction = "Get a valid phone number before assigning sales follow-up.";
  } else if (followUpStatus === "overdue") {
    recommendedAction = "Call today and update the follow-up outcome.";
  } else if (followUpStatus === "due") {
    recommendedAction = "Call today using the latest demand notes.";
  } else if (priority === "high") {
    recommendedAction = "Prioritize this lead for sales follow-up and confirm requirements.";
  } else if (priority === "medium") {
    recommendedAction = "Send a follow-up message and collect missing decision details.";
  } else {
    recommendedAction = "Keep in a low-touch nurture list unless new interest appears.";
  }

  return {
    priority,
    potentialScore,
    priorityReason: reasons.length ? reasons.join(", ") : "limited demand signals",
    recommendedAction,
    missingFields,
    followUpStatus,
  };
}

export function buildBusinessInsights(records: Array<DemandAnalysisInput & DemandAnalysis>) {
  const openRecords = records.filter((record) => !["closed", "completed"].includes(record.status));
  const highPriority = openRecords.filter((record) => record.priority === "high");
  const missingPhone = openRecords.filter((record) => record.missingFields.includes("phone"));
  const overdue = openRecords.filter((record) => record.followUpStatus === "overdue");
  const dueToday = openRecords.filter((record) => record.followUpStatus === "due");

  return [
    {
      type: "sales",
      severity: highPriority.length > 0 ? "urgent" : "info",
      title: "High potential leads",
      message:
        highPriority.length > 0
          ? `${highPriority.length} high-priority lead(s) should be handled before general follow-up.`
          : "No high-priority open lead is detected from current demand data.",
      recommendedAction:
        highPriority.length > 0
          ? "Assign the top high-priority customers to sales today."
          : "Keep importing demand data and review medium-priority leads.",
    },
    {
      type: "marketing",
      severity: missingPhone.length > 0 ? "warning" : "info",
      title: "Phone capture quality",
      message:
        missingPhone.length > 0
          ? `${missingPhone.length} open lead(s) do not have phone numbers.`
          : "Phone numbers are available for all open leads.",
      recommendedAction:
        missingPhone.length > 0
          ? "Ask marketing to improve phone collection before pushing these leads to sales."
          : "Continue the current lead capture format.",
    },
    {
      type: "sales",
      severity: overdue.length > 0 ? "urgent" : dueToday.length > 0 ? "warning" : "info",
      title: "Follow-up pressure",
      message:
        overdue.length > 0
          ? `${overdue.length} follow-up(s) are overdue.`
          : dueToday.length > 0
            ? `${dueToday.length} follow-up(s) are due today.`
            : "No urgent follow-up pressure is detected.",
      recommendedAction:
        overdue.length > 0 || dueToday.length > 0
          ? "Work this list first and update statuses after calls."
          : "Schedule follow-up dates for leads that still have no next action.",
    },
  ];
}
