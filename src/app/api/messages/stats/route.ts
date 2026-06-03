import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/messages/stats — dashboard statistics
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [totalMessages, todayMessages, totalSenders, weekMessages, businessReports, futurePlans] = await Promise.all([
    prisma.telegramMessage.count(),
    prisma.telegramMessage.count({
      where: { receivedAt: { gte: startOfToday } },
    }),
    prisma.telegramSender.count(),
    prisma.telegramMessage.count({
      where: { receivedAt: { gte: sevenDaysAgo } },
    }),
    prisma.demandRecord.count({ where: { reportType: "business_report" } }),
    prisma.demandRecord.count({ where: { reportType: "future_plan" } }),
  ]);

  return NextResponse.json({
    totalMessages,
    todayMessages,
    totalSenders,
    weekMessages,
    businessReports,
    futurePlans,
  });
}
