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
  const [totalMessages, todayMessages, totalSenders, weekMessages, todayDemandRecords, dueTodayFollowUps, pendingDemandRecords] =
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

  return NextResponse.json({
    totalMessages,
    todayMessages,
    totalSenders,
    weekMessages,
    todayDemandRecords,
    dueTodayFollowUps,
    pendingDemandRecords,
    botActive: botSettings?.isActive ?? false,
    recentMessages: serializedMessages,
    isAdmin,
    adminStats,
  });
}
