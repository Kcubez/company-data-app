import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/business-reports/stats
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom") || undefined;
  const dateTo = searchParams.get("dateTo") || undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (dateFrom || dateTo) {
    where.reportDate = {};
    if (dateFrom) where.reportDate.gte = new Date(dateFrom);
    if (dateTo) where.reportDate.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  const [totals, channelGroups, recentRecords] = await Promise.all([
    prisma.businessReport.aggregate({
      where,
      _sum: {
        marketingBudget: true,
        callsMade: true,
        appointmentsMade: true,
        appointmentsKept: true,
        newLeads: true,
        totalDemandCount: true,
        totalSalesAmount: true,
        closedDeals: true,
        pendingDeals: true,
      },
      _count: { _all: true },
    }),
    prisma.businessReport.groupBy({
      by: ["marketingChannel"],
      where: { ...where, marketingChannel: { not: null } },
      _sum: {
        marketingBudget: true,
        totalSalesAmount: true,
        newLeads: true,
        closedDeals: true,
      },
      _count: { _all: true },
      orderBy: { _sum: { totalSalesAmount: "desc" } },
    }),
    // Last 14 days for the daily chart
    prisma.businessReport.findMany({
      where,
      orderBy: { reportDate: "asc" },
      take: 60,
      select: {
        reportDate: true,
        totalSalesAmount: true,
        marketingBudget: true,
        newLeads: true,
        closedDeals: true,
      },
    }),
  ]);

  const s = totals._sum;
  const totalReports = totals._count._all;
  const totalBudget = s.marketingBudget ?? 0;
  const totalSales = s.totalSalesAmount ?? 0;
  const totalLeads = s.newLeads ?? 0;
  const totalClosed = s.closedDeals ?? 0;
  const totalCalls = s.callsMade ?? 0;
  const totalApptsMade = s.appointmentsMade ?? 0;
  const totalApptsKept = s.appointmentsKept ?? 0;
  const totalDemand = s.totalDemandCount ?? 0;
  const totalPending = s.pendingDeals ?? 0;

  const conversionRate = totalLeads > 0 ? Math.round((totalClosed / totalLeads) * 100) : 0;
  const apptShowRate = totalApptsMade > 0 ? Math.round((totalApptsKept / totalApptsMade) * 100) : 0;
  const costPerLead = totalLeads > 0 ? Math.round(totalBudget / totalLeads) : 0;
  const roi = totalBudget > 0 ? Math.round(((totalSales - totalBudget) / totalBudget) * 100) : 0;

  const channelPerformance = channelGroups.map((g) => ({
    channel: g.marketingChannel || "Unknown",
    count: g._count._all,
    budget: g._sum.marketingBudget ?? 0,
    sales: g._sum.totalSalesAmount ?? 0,
    leads: g._sum.newLeads ?? 0,
    closed: g._sum.closedDeals ?? 0,
  }));

  // Group recent records by date for daily trend chart
  const dailyMap = new Map<string, { sales: number; budget: number; leads: number }>();
  for (const r of recentRecords) {
    const key = r.reportDate.toISOString().slice(0, 10);
    const existing = dailyMap.get(key) ?? { sales: 0, budget: 0, leads: 0 };
    dailyMap.set(key, {
      sales: existing.sales + (r.totalSalesAmount ?? 0),
      budget: existing.budget + (r.marketingBudget ?? 0),
      leads: existing.leads + (r.newLeads ?? 0),
    });
  }
  const dailyTrend = Array.from(dailyMap.entries()).map(([date, v]) => ({ date, ...v }));

  return NextResponse.json({
    totalReports,
    totalBudget,
    totalSales,
    totalLeads,
    totalClosed,
    totalCalls,
    totalApptsMade,
    totalApptsKept,
    totalDemand,
    totalPending,
    conversionRate,
    apptShowRate,
    costPerLead,
    roi,
    channelPerformance,
    dailyTrend,
  });
}
