import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/daily-report/stats — daily report specific stats
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const [totalReports, todayReports, pendingReports, dueToday] = await Promise.all([
    prisma.demandRecord.count(),
    prisma.demandRecord.count({
      where: {
        createdAt: { gte: startOfToday },
      },
    }),
    prisma.demandRecord.count({
      where: { status: "pending" },
    }),
    prisma.demandRecord.count({
      where: {
        followUpDate: { gte: startOfToday, lt: endOfToday },
      },
    }),
  ]);

  return NextResponse.json({
    totalReports,
    todayReports,
    pendingReports,
    dueToday,
  });
}