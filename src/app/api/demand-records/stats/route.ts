import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(startOfToday);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const [
    totalRecords,
    todayRecords,
    dueToday,
    pendingRecords,
    dailyReports,
    customerFollowUps,
    recentRecords,
  ] = await Promise.all([
    prisma.demandRecord.count(),
    prisma.demandRecord.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.demandRecord.count({
      where: {
        followUpDate: {
          gte: startOfToday,
          lt: tomorrow,
        },
      },
    }),
    prisma.demandRecord.count({ where: { status: "pending" } }),
    prisma.demandRecord.count({ where: { reportType: "daily_report" } }),
    prisma.demandRecord.count({ where: { reportType: "customer_follow_up" } }),
    prisma.demandRecord.findMany({
      take: 5,
      orderBy: { createdAt: "desc" },
      include: { sender: true },
    }),
  ]);

  return NextResponse.json({
    totalRecords,
    todayRecords,
    dueToday,
    pendingRecords,
    dailyReports,
    customerFollowUps,
    recentRecords: recentRecords.map((record) => ({
      id: record.id,
      reportType: record.reportType,
      customerName: record.customerName,
      category: record.category,
      status: record.status,
      note: record.note.length > 90 ? `${record.note.slice(0, 90)}...` : record.note,
      senderName: record.sender.displayName,
      createdAt: record.createdAt.toISOString(),
      followUpDate: record.followUpDate?.toISOString() ?? null,
    })),
  });
}
