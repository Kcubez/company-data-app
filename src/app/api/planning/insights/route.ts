import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin, senderOwnedByUserOrAdmin, ownedByUserOrAdmin } from "@/lib/tenant-scope";
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

const DAY = 24 * 60 * 60 * 1000;

type Priority = {
  title: string;
  impact: "high" | "medium" | "low";
  rationale: string;
  action: string;
  actionHref: string;
};

type PlanStep = {
  horizon: "Next 30 days" | "Next 60 days" | "Next 90 days";
  goal: string;
  actions: string[];
};

function number(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeDate(value: string | null, fallback: Date): Date {
  if (!value) return fallback;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function parseAiResult(text: string): { executiveSummary?: string; futureOutlook?: string; priorities?: Priority[]; plan?: PlanStep[] } | null {
  try {
    const parsed = JSON.parse(text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function buildScenarios(snapshot: { projectedRevenue30: number; projectedExpenses30: number }) {
  const scenario = (name: string, revenueMultiplier: number, expenseMultiplier: number, description: string) => {
    const revenue = Math.round(snapshot.projectedRevenue30 * revenueMultiplier);
    const expenses = Math.round(snapshot.projectedExpenses30 * expenseMultiplier);
    return { name, revenue, expenses, profit: revenue - expenses, description };
  };
  return [
    scenario("Downside", 0.85, 1.03, "Lower conversion and slightly higher operating costs."),
    scenario("Base case", 1, 1, "Current daily operating pace continues."),
    scenario("Upside", 1.15, 1.03, "Better follow-up conversion with controlled spend."),
  ];
}

// GET /api/planning/insights?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const today = new Date();
  const rawDateFrom = req.nextUrl.searchParams.get("dateFrom");
  const rawDateTo = req.nextUrl.searchParams.get("dateTo");

  // Omitted or empty params mean overall (all-time) mode
  const isOverall = !rawDateFrom && !rawDateTo;

  const defaultFrom = new Date(today.getTime() - 29 * DAY);
  const start = isOverall ? new Date(0) : safeDate(rawDateFrom, defaultFrom);
  const endDate = isOverall ? today : safeDate(rawDateTo, today);
  const end = new Date(endDate.getTime() + DAY);

  if (!isOverall && start >= end) {
    return NextResponse.json({ message: "Start date must be before end date" }, { status: 400 });
  }

  const uploadedScope = { ...uploadedByUserOrAdmin(session), ...notDeleted };
  const demandScope = { ...senderOwnedByUserOrAdmin(session), ...notDeleted };
  const riskDate = new Date(today.getTime() + 30 * DAY);

  const reportWhere = isOverall
    ? uploadedScope
    : { ...uploadedScope, reportDate: { gte: start, lt: end } };
  const financeWhere = isOverall
    ? uploadedScope
    : { ...uploadedScope, entryDate: { gte: start, lt: end } };
  const demandWhere = isOverall
    ? demandScope
    : { ...demandScope, createdAt: { gte: start, lt: end } };

  const [reports, financeEntries, demands, projects, settings] = await Promise.all([
    prisma.businessReport.findMany({
      where: reportWhere,
      select: {
        reportDate: true,
        marketingBudget: true,
        totalSalesAmount: true,
        totalDemandCount: true,
        closedDeals: true,
        pendingDeals: true,
      },
    }),
    prisma.financeEntry.findMany({
      where: financeWhere,
      select: { entryDate: true, type: true, amount: true, status: true, dueDate: true },
    }),
    prisma.demandRecord.findMany({
      where: demandWhere,
      select: { createdAt: true, status: true, serviceAmount: true, serviceQty: true, priority: true },
    }),
    prisma.projectExpiration.findMany({
      where: { ...uploadedScope },
      select: { projectStatus: true, domainExpireDate: true, hostingExpireDate: true, offerExpireDate: true },
    }),
    prisma.botSettings.findFirst({
      where: { isActive: true, ...ownedByUserOrAdmin(session) },
      select: { geminiApiKey: true, geminiModel: true },
    }),
  ]);

  // Determine periodDays
  let periodDays = 30;
  if (!isOverall) {
    periodDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY));
  } else {
    // For overall, calculate days from earliest record to today
    const dates: number[] = [];
    reports.forEach((r) => r.reportDate && dates.push(new Date(r.reportDate).getTime()));
    financeEntries.forEach((f) => f.entryDate && dates.push(new Date(f.entryDate).getTime()));
    demands.forEach((d) => d.createdAt && dates.push(new Date(d.createdAt).getTime()));
    if (dates.length > 0) {
      const earliest = Math.min(...dates);
      const diff = Math.ceil((today.getTime() - earliest) / DAY);
      periodDays = Math.max(30, diff);
    }
  }

  const reportRevenue = reports.reduce((sum, report) => sum + number(report.totalSalesAmount), 0);
  const closedDemandRevenue = demands
    .filter((record) => ["closed", "completed"].includes(record.status))
    .reduce((sum, record) => sum + number(record.serviceAmount), 0);
  const revenue = reportRevenue + closedDemandRevenue;
  const marketingSpend = reports.reduce((sum, report) => sum + number(report.marketingBudget), 0);
  const operatingExpense = financeEntries
    .filter((entry) => ["salary", "cogs", "operating_expense"].includes(entry.type))
    .reduce((sum, entry) => sum + number(entry.amount), 0);
  const expenses = marketingSpend + operatingExpense;
  const demandCount = Math.max(
    demands.length,
    reports.reduce((sum, report) => sum + number(report.totalDemandCount), 0),
  );
  const pendingDeals =
    reports.reduce((sum, report) => sum + number(report.pendingDeals), 0) +
    demands.filter((record) => !["closed", "completed"].includes(record.status)).length;
  const highPriorityLeads = demands.filter(
    (record) => record.priority === "high" && !["closed", "completed"].includes(record.status),
  ).length;
  const receivables = financeEntries
    .filter((entry) => entry.type === "receivable" && !["paid", "settled"].includes(entry.status))
    .reduce((sum, entry) => sum + number(entry.amount), 0);
  const overdueDebt = financeEntries
    .filter(
      (entry) =>
        entry.type === "debt" &&
        (entry.status === "overdue" || (entry.dueDate && entry.dueDate < today && entry.status !== "settled")),
    )
    .reduce((sum, entry) => sum + number(entry.amount), 0);
  const upcomingExpiries = projects.filter((project) =>
    [project.domainExpireDate, project.hostingExpireDate, project.offerExpireDate].some(
      (date) => date && date >= today && date <= riskDate,
    ),
  ).length;
  const maintenanceProjects = projects.filter((project) => project.projectStatus === "maintenance").length;

  const projectedRevenue30 = Math.round((revenue / periodDays) * 30);
  const projectedExpenses30 = Math.round((expenses / periodDays) * 30);
  const baseProfit30 = projectedRevenue30 - projectedExpenses30;

  const snapshot = {
    periodDays,
    revenue,
    expenses,
    profit: revenue - expenses,
    margin: revenue > 0 ? Math.round(((revenue - expenses) / revenue) * 100) : 0,
    demandCount,
    pendingDeals,
    highPriorityLeads,
    receivables,
    overdueDebt,
    upcomingExpiries,
    maintenanceProjects,
    projectedRevenue30,
    projectedExpenses30,
    projectedProfit30: baseProfit30,
  };

  const priorities: Priority[] = [];
  if (receivables > 0)
    priorities.push({
      title: "Collect outstanding receivables",
      impact: "high",
      rationale: `There is ${receivables.toLocaleString()} MMK awaiting collection, which can constrain cash flow.`,
      action: "Review receivables",
      actionHref: "/finance?type=receivable",
    });
  if (upcomingExpiries > 0)
    priorities.push({
      title: "Protect upcoming renewals",
      impact: "high",
      rationale: `${upcomingExpiries} domain, hosting, or offer expiry item(s) fall within the next 30 days.`,
      action: "Review project risks",
      actionHref: "/projects-infra",
    });
  if (pendingDeals > 0 || highPriorityLeads > 0)
    priorities.push({
      title: "Convert the active pipeline",
      impact: pendingDeals > 8 ? "high" : "medium",
      rationale: `${pendingDeals} open deal(s), including ${highPriorityLeads} high-priority lead(s), need a clear next action.`,
      action: "Open sales pipeline",
      actionHref: "/sales-marketing",
    });
  if (snapshot.margin < 20 || expenses > revenue)
    priorities.push({
      title: "Improve margin discipline",
      impact: "high",
      rationale: `The current period margin is ${snapshot.margin}%. Review spend before increasing acquisition activity.`,
      action: "Review expenses",
      actionHref: "/finance",
    });
  if (priorities.length === 0)
    priorities.push({
      title: "Scale the strongest operating rhythm",
      impact: "medium",
      rationale: "No immediate cash-flow or renewal risk was detected in the selected period.",
      action: "Review sales performance",
      actionHref: "/sales-marketing",
    });

  const fallback = {
    executiveSummary: `Selected-period revenue is ${revenue.toLocaleString()} MMK with a ${snapshot.margin}% margin. The next 30-day base case projects ${baseProfit30.toLocaleString()} MMK profit if the current operating pace continues.`,
    futureOutlook:
      baseProfit30 >= 0
        ? "The base case is positive, but collecting open receivables and converting active deals will determine whether growth is sustainable."
        : "The current pace projects a loss. Prioritise cash collection, conversion, and expense control before adding more spend.",
    priorities: priorities.slice(0, 3),
    plan: [
      {
        horizon: "Next 30 days" as const,
        goal: "Stabilise cash and pipeline",
        actions: [
          "Assign every pending deal a next follow-up date.",
          "Collect or schedule all outstanding receivables.",
          "Confirm renewal ownership for expiring projects.",
        ],
      },
      {
        horizon: "Next 60 days" as const,
        goal: "Improve repeatable conversion",
        actions: [
          "Compare lead sources against closed revenue.",
          "Standardise a follow-up playbook for high-priority leads.",
          "Review salary, COGS, and operating expenses against revenue.",
        ],
      },
      {
        horizon: "Next 90 days" as const,
        goal: "Plan measured growth",
        actions: [
          "Set a realistic quarterly revenue and margin target.",
          "Invest only in channels with proven conversion.",
          "Move stable projects into a scheduled maintenance plan.",
        ],
      },
    ],
  };

  if (!settings?.geminiApiKey) {
    return NextResponse.json({ snapshot, scenarios: buildScenarios(snapshot), ...fallback, source: "heuristic" });
  }

  try {
    const prompt = `You are a practical business planning analyst. Use this approved operational snapshot to produce a concise future-condition analysis. Write every explanation, rationale, and action in Burmese (Myanmar language). Keep titles short. Do not invent facts. Return ONLY JSON matching this exact shape:\n{ "executiveSummary": string, "futureOutlook": string, "priorities": [{"title": string, "impact": "high"|"medium"|"low", "rationale": string, "action": string, "actionHref": string}], "plan": [{"horizon":"Next 30 days"|"Next 60 days"|"Next 90 days", "goal":string, "actions":[string,string,string]}] }\nAllowed actionHref values: /finance, /finance?type=receivable, /sales-marketing, /customer-service, /projects-infra. Max 3 priorities.\nSnapshot: ${JSON.stringify(snapshot)}`;
    const genAI = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const response = await genAI.models.generateContent({
      model: settings.geminiModel || "gemini-2.0-flash-lite",
      contents: prompt,
    });
    const ai = response.text ? parseAiResult(response.text) : null;
    if (!ai?.executiveSummary || !ai.futureOutlook || !Array.isArray(ai.priorities) || !Array.isArray(ai.plan))
      throw new Error("Invalid planning response");
    return NextResponse.json({ snapshot, scenarios: buildScenarios(snapshot), ...ai, source: "ai" });
  } catch (error) {
    console.error("Planning insight generation failed:", error);
    return NextResponse.json({ snapshot, scenarios: buildScenarios(snapshot), ...fallback, source: "heuristic" });
  }
}
