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
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalMessages, todayMessages, totalSenders, weekMessages, totalCustomers] =
    await Promise.all([
      prisma.telegramMessage.count(),
      prisma.telegramMessage.count({ where: { receivedAt: { gte: startOfToday } } }),
      prisma.telegramSender.count(),
      prisma.telegramMessage.count({ where: { receivedAt: { gte: sevenDaysAgo } } }),
      prisma.customer.count(),
    ]);

  // Business Report aggregations
  const bizAgg = await prisma.demandRecord.aggregate({
    _sum: { totalSales: true, demand: true, marketingBudget: true },
    where: { reportType: 'business_report' },
  });

  // Sum appointments separately (Int field)
  const apptAgg = await prisma.demandRecord.aggregate({
    _sum: { appointments: true },
    where: { reportType: 'business_report' },
  });

  const bizCount = await prisma.demandRecord.count({ where: { reportType: 'business_report' } });
  const planCount = await prisma.demandRecord.count({ where: { reportType: 'future_plan' } });

  // Service breakdown (top services)
  const serviceRecords = await prisma.demandRecord.findMany({
    where: { reportType: 'business_report', serviceName: { not: null } },
    select: { serviceName: true, serviceAmount: true, serviceQty: true },
  });
  const serviceMap = new Map<string, { count: number; totalAmount: number; totalQty: number }>();
  for (const r of serviceRecords) {
    if (!r.serviceName) continue;
    const existing = serviceMap.get(r.serviceName) || { count: 0, totalAmount: 0, totalQty: 0 };
    existing.count++;
    existing.totalAmount += r.serviceAmount || 0;
    existing.totalQty += r.serviceQty || 0;
    serviceMap.set(r.serviceName, existing);
  }
  const topServices = Array.from(serviceMap.entries())
    .map(([name, stats]) => ({ name, ...stats }))
    .sort((a, b) => b.totalAmount - a.totalAmount)
    .slice(0, 10);

  // Project statuses
  const projectRecords = await prisma.demandRecord.findMany({
    where: { reportType: 'business_report', projectName: { not: null } },
    select: { projectName: true, projectStatus: true, note: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  const projectMap = new Map<string, { status: string; note: string; lastUpdate: string }>();
  for (const r of projectRecords) {
    if (!r.projectName || projectMap.has(r.projectName)) continue;
    projectMap.set(r.projectName, {
      status: r.projectStatus || 'unknown',
      note: r.note.length > 80 ? r.note.slice(0, 80) + '...' : r.note,
      lastUpdate: r.createdAt.toISOString(),
    });
  }
  const projects = Array.from(projectMap.entries())
    .map(([name, data]) => ({ name, ...data }))
    .slice(0, 10);

  // Follow-up clients from future plans
  const followUps = await prisma.demandRecord.findMany({
    where: { reportType: 'future_plan', followUpClient: { not: null } },
    select: { followUpClient: true, followUpReason: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Focus services from future plans
  const focusServices = await prisma.demandRecord.findMany({
    where: { reportType: 'future_plan', focusService: { not: null } },
    select: { focusService: true, focusReason: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  // Delayed projects from future plans
  const delayedProjects = await prisma.demandRecord.findMany({
    where: { reportType: 'future_plan', delayedProject: { not: null } },
    select: { delayedProject: true, delayReason: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  // Weekly activity
  const weeklyActivity: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(startOfToday);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const count = await prisma.demandRecord.count({
      where: { createdAt: { gte: dayStart, lt: dayEnd } },
    });
    weeklyActivity.push({ date: dayStart.toISOString().slice(0, 10), count });
  }

  // Bot status
  const botSettings = await prisma.botSettings.findFirst({ where: { isActive: true } });

  // Recent messages
  const recentMessages = await prisma.telegramMessage.findMany({
    orderBy: { receivedAt: 'desc' },
    take: 5,
    include: { sender: true },
  });

  // Admin stats
  let isAdmin = false;
  let adminStats = null;
  if (session.user.role === 'admin') {
    isAdmin = true;
    const [totalUsers, activeSessions] = await Promise.all([
      prisma.user.count(),
      prisma.session.count({ where: { expiresAt: { gt: now } } }),
    ]);
    adminStats = { totalUsers, activeSessions };
  }

  return NextResponse.json({
    totalMessages,
    todayMessages,
    totalSenders,
    weekMessages,
    totalCustomers,
    botActive: !!botSettings,
    // Business report stats
    bizCount,
    planCount,
    totalSales: bizAgg._sum.totalSales || 0,
    totalDemand: bizAgg._sum.demand || 0,
    totalAppointments: apptAgg._sum.appointments || 0,
    totalMarketingBudget: bizAgg._sum.marketingBudget || 0,
    topServices,
    projects,
    // Future plan stats
    followUps: followUps.map(f => ({
      client: f.followUpClient,
      reason: f.followUpReason,
      date: f.createdAt.toISOString(),
    })),
    focusServices: focusServices.map(f => ({
      service: f.focusService,
      reason: f.focusReason,
    })),
    delayedProjects: delayedProjects.map(d => ({
      project: d.delayedProject,
      reason: d.delayReason,
    })),
    weeklyActivity,
    recentMessages: recentMessages.map(m => ({
      id: m.id,
      text: m.text.length > 80 ? m.text.slice(0, 80) + '...' : m.text,
      senderName: m.sender.displayName,
      senderUsername: m.sender.username,
      receivedAt: m.receivedAt.toISOString(),
    })),
    isAdmin,
    adminStats,
  });
}
