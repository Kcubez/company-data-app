import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/dashboard/stats — dashboard overview stats
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const isAdmin = session.user.role === "admin";

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // Common stats for all users
  const [totalMessages, todayMessages, totalSenders, weekMessages, todayDemandRecords, dueTodayFollowUps, pendingDemandRecords, totalCustomers] =
    await Promise.all([
      prisma.telegramMessage.count(),
      prisma.telegramMessage.count({
        where: { receivedAt: { gte: startOfToday } },
      }),
      prisma.telegramSender.count(),
      prisma.telegramMessage.count({
        where: { receivedAt: { gte: sevenDaysAgo } },
      }),
      prisma.demandRecord.count({
        where: { createdAt: { gte: startOfToday } },
      }),
      prisma.demandRecord.count({
        where: {
          followUpDate: {
            gte: startOfToday,
            lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.demandRecord.count({ where: { status: "pending" } }),
      prisma.customer.count(),
    ]);

  // Bot settings for current user
  const botSettings = await prisma.botSettings.findUnique({
    where: { userId: session.user.id },
  });

  // Recent messages (last 5)
  const recentMessages = await prisma.telegramMessage.findMany({
    take: 5,
    orderBy: { receivedAt: "desc" },
    include: { sender: true },
  });

  const serializedMessages = recentMessages.map((msg) => ({
    id: msg.id,
    text: msg.text.length > 80 ? msg.text.slice(0, 80) + "…" : msg.text,
    senderName: msg.sender.displayName,
    senderUsername: msg.sender.username,
    receivedAt: msg.receivedAt.toISOString(),
  }));

  // Admin-only stats
  let adminStats = null;
  if (isAdmin) {
    const [totalUsers, activeSessions] = await Promise.all([
      prisma.user.count(),
      prisma.session.count({
        where: { expiresAt: { gt: now } },
      }),
    ]);
    adminStats = { totalUsers, activeSessions };
  }

  // Pipeline counts
  const [pipelineNew, pipelineContacted, pipelineQuoted, pipelinePending, pipelineClosed] =
    await Promise.all([
      prisma.demandRecord.count({ where: { status: 'new' } }),
      prisma.demandRecord.count({ where: { status: 'contacted' } }),
      prisma.demandRecord.count({ where: { status: 'quoted' } }),
      prisma.demandRecord.count({ where: { status: 'pending' } }),
      prisma.demandRecord.count({ where: { status: 'closed' } }),
    ]);

  // Quantity/amount aggregation for closed deals
  const salesAgg = await prisma.demandRecord.aggregate({
    _sum: { quantity: true, amount: true },
    where: { status: 'closed' },
  });

  // Weekly activity (last 7 days)
  const weeklyActivity: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const dayStart = new Date(startOfToday);
    dayStart.setDate(dayStart.getDate() - i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const count = await prisma.demandRecord.count({
      where: {
        createdAt: { gte: dayStart, lt: dayEnd },
      },
    });
    weeklyActivity.push({
      date: dayStart.toISOString().slice(0, 10),
      count,
    });
  }

  // Top products
  const allProductRecords = await prisma.demandRecord.findMany({
    where: { product: { not: null } },
    select: { product: true, quantity: true },
  });
  const productMap = new Map<string, { count: number; totalQty: number }>();
  for (const r of allProductRecords) {
    if (!r.product) continue;
    const existing = productMap.get(r.product) || { count: 0, totalQty: 0 };
    existing.count++;
    existing.totalQty += r.quantity || 0;
    productMap.set(r.product, existing);
  }
  const topProducts = Array.from(productMap.entries())
    .map(([product, stats]) => ({ product, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // Due today follow-ups with details
  const dueTodayRecords = await prisma.demandRecord.findMany({
    where: {
      followUpDate: {
        gte: startOfToday,
        lt: new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000),
      },
      status: { not: 'closed' },
    },
    include: { sender: true },
    take: 10,
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({
    totalMessages,
    todayMessages,
    totalSenders,
    weekMessages,
    todayDemandRecords,
    dueTodayFollowUps,
    pendingDemandRecords,
    totalCustomers,
    botActive: botSettings?.isActive ?? false,
    recentMessages: serializedMessages,
    isAdmin,
    adminStats,
    pipeline: {
      new: pipelineNew,
      contacted: pipelineContacted,
      quoted: pipelineQuoted,
      pending: pipelinePending,
      closed: pipelineClosed,
    },
    totalQuantitySold: salesAgg._sum.quantity || 0,
    totalAmountSold: salesAgg._sum.amount || 0,
    weeklyActivity,
    topProducts,
    dueTodayRecords: dueTodayRecords.map((r) => ({
      id: r.id,
      customerName: r.customerName,
      product: r.product,
      quantity: r.quantity,
      status: r.status,
      note: r.note.length > 80 ? r.note.slice(0, 80) + '…' : r.note,
      senderName: r.sender.displayName,
      followUpDate: r.followUpDate?.toISOString() ?? null,
    })),
  });
}
