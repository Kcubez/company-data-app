import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin, senderOwnedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

const DAY = 24 * 60 * 60 * 1000;

type Priority = {
  title: string;
  impact: "high" | "medium" | "low";
  rationale: string;
  action: string;
  actionHref: string;
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

  const [reports, financeEntries, demands, projects] = await Promise.all([
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
    .reduce((sum, record) => sum + number(record.serviceAmount) * number(record.serviceQty ?? 1), 0);
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
      title: "Receivable များ ကောက်ခံရန်",
      impact: "high",
      rationale: `${receivables.toLocaleString()} MMK Receivable များ မကောက်ခံရသေးပါ။ Cash Flow ကို ထိခိုက်စေနိုင်သည်။`,
      action: "Receivable များ စစ်ဆေးရန်",
      actionHref: "/finance?type=receivable",
    });
  if (upcomingExpiries > 0)
    priorities.push({
      title: "သက်တမ်းတိုးမှုများ စီမံရန်",
      impact: "high",
      rationale: `လာမည့် ၃၀ ရက်အတွင်း Domain၊ Hosting သို့မဟုတ် Offer သက်တမ်းကုန်မည့် Project ${upcomingExpiries} ခု ရှိသည်။`,
      action: "Project Risk များ စစ်ဆေးရန်",
      actionHref: "/projects-infra",
    });
  if (pendingDeals > 0 || highPriorityLeads > 0)
    priorities.push({
      title: "Active Pipeline ကို ပိတ်သိမ်းရန်",
      impact: pendingDeals > 8 ? "high" : "medium",
      rationale: `High-Priority Lead ${highPriorityLeads} ခုအပါအဝင် Open Deal ${pendingDeals} ခုအတွက် နောက်တစ်ဆင့် လုပ်ဆောင်ချက် သတ်မှတ်ရန်လိုသည်။`,
      action: "Sales Pipeline ဖွင့်ရန်",
      actionHref: "/sales-marketing",
    });
  if (snapshot.margin < 20 || expenses > revenue)
    priorities.push({
      title: "Profit Margin တိုးတက်စေရန်",
      impact: "high",
      rationale: `လက်ရှိကာလ Profit Margin သည် ${snapshot.margin}% ဖြစ်သည်။ Marketing Budget တိုးမီ Expense များကို စစ်ဆေးပါ။`,
      action: "Expense များ စစ်ဆေးရန်",
      actionHref: "/finance",
    });
  if (priorities.length === 0)
    priorities.push({
      title: "ကောင်းမွန်သော လုပ်ငန်းလည်ပတ်မှုကို ဆက်လုပ်ရန်",
      impact: "medium",
      rationale: "ရွေးချယ်ထားသောကာလတွင် Cash Flow သို့မဟုတ် Renewal အရေးပေါ်အန္တရာယ် မတွေ့ရပါ။",
      action: "Sales Performance စစ်ဆေးရန်",
      actionHref: "/sales-marketing",
    });

  const fallback = {
    executiveSummary: `ရွေးချယ်ထားသောကာလ ဝင်ငွေသည် ${revenue.toLocaleString()} MMK နှင့် Profit Margin ${snapshot.margin}% ဖြစ်သည်။ လက်ရှိလုပ်ငန်းနှုန်းအတိုင်း ဆက်သွားလျှင် လာမည့် ၃၀ ရက်တွင် အမြတ် ${baseProfit30.toLocaleString()} MMK ရနိုင်မည်ဟု ခန့်မှန်းထားသည်။`,
    futureOutlook:
      baseProfit30 >= 0
        ? "အခြေခံခန့်မှန်းချက်သည် ကောင်းမွန်သော်လည်း Receivable ကောက်ခံခြင်းနှင့် Active Deal များ ပိတ်သိမ်းခြင်းက တိုးတက်မှုကို ဆုံးဖြတ်မည်ဖြစ်သည်။"
        : "လက်ရှိလုပ်ငန်းနှုန်းအရ အရှုံးဖြစ်နိုင်သည်။ Marketing Budget မတိုးမီ Cash Collection၊ Conversion နှင့် Expense Control ကို ဦးစားပေးပါ။",
    priorities: priorities.slice(0, 3),
    plan: [
      {
        horizon: "Next 30 days" as const,
        goal: "Cash Flow နှင့် Sales Pipeline တည်ငြိမ်စေရန်",
        actions: [
          "Pending Deal တိုင်းအတွက် နောက်တစ်ကြိမ် Follow-up ရက် သတ်မှတ်ပါ။",
          "ကျန်ရှိနေသော Receivable များကို ကောက်ခံရန် သို့မဟုတ် ရက်ချိန်းသတ်မှတ်ပါ။",
          "သက်တမ်းကုန်မည့် Project များအတွက် တာဝန်ရှိသူကို အတည်ပြုပါ။",
        ],
      },
      {
        horizon: "Next 60 days" as const,
        goal: "ထပ်တလဲလဲ အသုံးချနိုင်သော Conversion တိုးတက်စေရန်",
        actions: [
          "Lead Source များကို Closed Revenue နှင့် နှိုင်းယှဉ်ပါ။",
          "High-Priority Lead များအတွက် Follow-up Playbook ကို စံသတ်မှတ်ပါ။",
          "Salary, COGS နှင့် Operating Expense များကို Revenue နှင့် နှိုင်းယှဉ်စစ်ဆေးပါ။",
        ],
      },
      {
        horizon: "Next 90 days" as const,
        goal: "ထိန်းချုပ်ထားသော တိုးတက်မှု စီမံရန်",
        actions: [
          "လက်တွေ့ကျသော Quarterly Revenue နှင့် Margin Target သတ်မှတ်ပါ။",
          "Conversion သက်သေပြပြီးသော Channel များတွင်သာ Budget ထည့်ပါ။",
          "တည်ငြိမ်သော Project များကို Scheduled Maintenance Plan ထဲ ထည့်ပါ။",
        ],
      },
    ],
  };

  // Planning is deliberately calculated from the approved operational data.
  // It does not call an external AI service.
  return NextResponse.json({ snapshot, scenarios: buildScenarios(snapshot), ...fallback, source: "local" });

}
