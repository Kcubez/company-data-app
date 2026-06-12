import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/dashboard/stats — dashboard overview stats
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const { searchParams } = req.nextUrl;
  const monthParam = Number(searchParams.get("month") || now.getMonth() + 1);
  const yearParam = Number(searchParams.get("year") || now.getFullYear());
  const month = Math.min(12, Math.max(1, Number.isFinite(monthParam) ? monthParam : now.getMonth() + 1));
  const year = Number.isFinite(yearParam) ? yearParam : now.getFullYear();
  const periodStart = new Date(year, month - 1, 1);
  const periodEnd = new Date(year, month, 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalMessages,
    todayMessages,
    totalSenders,
    weekMessages,
    totalCustomers,
    botSettings,
    todayDemandRecords,
    pendingDemandRecords,
  ] = await Promise.all([
    prisma.telegramMessage.count(),
    prisma.telegramMessage.count({ where: { receivedAt: { gte: startOfToday } } }),
    prisma.telegramSender.count(),
    prisma.telegramMessage.count({ where: { receivedAt: { gte: sevenDaysAgo } } }),
    prisma.customer.count(),
    prisma.botSettings.findFirst({ where: { isActive: true } }),
    prisma.demandRecord.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.demandRecord.count({ where: { status: { notIn: ['closed', 'completed'] } } }),
  ]);

  // Messages List
  const messages = await prisma.telegramMessage.findMany({
    orderBy: { receivedAt: 'desc' },
    take: 5,
    include: { sender: true },
  });
  const recentMessages = messages.map(m => ({
    id: m.id,
    text: m.text.length > 80 ? m.text.slice(0, 80) + '...' : m.text,
    senderName: m.sender.displayName,
    senderUsername: m.sender.username,
    receivedAt: m.receivedAt.toISOString(),
  }));

  // Admin stats
  const isAdmin = session.user.role === 'admin';
  let adminStats = null;
  if (isAdmin) {
    const [totalUsers, activeSessions] = await Promise.all([
      prisma.user.count(),
      prisma.session.count({ where: { expiresAt: { gt: now } } }),
    ]);
    adminStats = { totalUsers, activeSessions };
  }

  // Pipeline Data
  const pipelineCounts = await prisma.demandRecord.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  const pipeline = {
    new: 0,
    contacted: 0,
    quoted: 0,
    pending: 0,
    closed: 0,
  };
  for (const row of pipelineCounts) {
    const status = row.status as keyof typeof pipeline;
    if (status in pipeline) {
      pipeline[status] = row._count._all;
    }
  }

  // Quantity and Amount Aggregations
  const [qtyAgg, amountAgg, businessAgg, highPriorityLeads, missingPhoneLeads] = await Promise.all([
    prisma.demandRecord.aggregate({
      _sum: { serviceQty: true },
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.demandRecord.aggregate({
      _sum: { serviceAmount: true },
      where: { createdAt: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.businessReport.aggregate({
      _sum: { marketingBudget: true, totalSalesAmount: true },
      where: { reportDate: { gte: periodStart, lt: periodEnd } },
    }),
    prisma.demandRecord.count({
      where: {
        priority: "high",
        status: { notIn: ["closed", "completed"] },
        createdAt: { gte: periodStart, lt: periodEnd },
      },
    }),
    prisma.demandRecord.count({
      where: {
        missingFields: { has: "phone" },
        status: { notIn: ["closed", "completed"] },
        createdAt: { gte: periodStart, lt: periodEnd },
      },
    }),
  ]);
  const totalQuantitySold = qtyAgg._sum.serviceQty || 0;
  const demandRevenue = amountAgg._sum.serviceAmount || 0;
  const reportRevenue = businessAgg._sum.totalSalesAmount || 0;
  const totalAmountSold = Math.max(demandRevenue, reportRevenue);
  const totalCost = businessAgg._sum.marketingBudget || 0;
  const profitLoss = totalAmountSold - totalCost;

  // Weekly Activity
  const weekStart = new Date(startOfToday);
  weekStart.setDate(weekStart.getDate() - 6);
  const groupedRecords = await prisma.demandRecord.groupBy({
    by: ['createdAt'],
    where: { createdAt: { gte: weekStart } },
    _count: { _all: true },
  });

  const formatLocalDate = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dateVal = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dateVal}`;
  };

  const countsByDay = new Map<string, number>();
  for (const row of groupedRecords) {
    const key = formatLocalDate(row.createdAt);
    countsByDay.set(key, (countsByDay.get(key) ?? 0) + row._count._all);
  }
  const weeklyActivity: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(startOfToday);
    dayStart.setDate(dayStart.getDate() - i);
    const key = formatLocalDate(dayStart);
    weeklyActivity.push({ date: key, count: countsByDay.get(key) ?? 0 });
  }

  // Top Services
  const serviceGroups = await prisma.demandRecord.groupBy({
    by: ['serviceName'],
    where: { serviceName: { not: null } },
    _count: { _all: true },
    _sum: { serviceQty: true },
    orderBy: { _count: { serviceName: 'desc' } },
    take: 5,
  });
  const topProducts = serviceGroups.map(g => ({
    product: g.serviceName || 'Unknown',
    count: g._count._all,
    totalQty: g._sum.serviceQty || 0,
  }));

  // Due Today Follow-ups
  const dueTodayRecordsRaw = await prisma.demandRecord.findMany({
    where: {
      followUpDate: {
        gte: startOfToday,
        lt: startOfTomorrow,
      },
    },
    include: {
      sender: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  const dueTodayRecords = dueTodayRecordsRaw.map(r => ({
    id: r.id,
    customerName: r.customerName,
    product: r.serviceName,
    quantity: r.serviceQty,
    status: r.status,
    note: r.note,
    senderName: r.sender.displayName,
    followUpDate: r.followUpDate ? r.followUpDate.toISOString() : null,
  }));
  const dueTodayFollowUps = dueTodayRecords.length;

  // Upcoming Follow-ups (from today onwards)
  const upcomingRecordsRaw = await prisma.demandRecord.findMany({
    where: {
      followUpDate: {
        gte: startOfToday,
      },
      status: { notIn: ['closed', 'completed'] },
    },
    include: {
      sender: true,
    },
    orderBy: { followUpDate: 'asc' },
    take: 10,
  });
  const upcomingRecords = upcomingRecordsRaw.map(r => ({
    id: r.id,
    customerName: r.customerName,
    product: r.serviceName,
    quantity: r.serviceQty,
    status: r.status,
    note: r.note,
    senderName: r.sender.displayName,
    followUpDate: r.followUpDate ? r.followUpDate.toISOString() : null,
  }));

  return NextResponse.json({
    totalMessages,
    todayMessages,
    totalSenders,
    weekMessages,
    todayDemandRecords,
    dueTodayFollowUps,
    pendingDemandRecords,
    totalCustomers,
    botActive: !!botSettings,
    recentMessages,
    isAdmin,
    adminStats,
    pipeline,
    totalQuantitySold,
    totalAmountSold,
    totalCost,
    profitLoss,
    selectedMonth: month,
    selectedYear: year,
    highPriorityLeads,
    missingPhoneLeads,
    weeklyActivity,
    topProducts,
    dueTodayRecords,
    upcomingRecords,
  });
}
