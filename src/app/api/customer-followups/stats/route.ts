import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/customer-followups/stats — customer followup specific stats
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const rangeWhere: Record<string, any> = {};
  if (dateFrom || dateTo) {
    rangeWhere.createdAt = {};
    if (dateFrom) rangeWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) rangeWhere.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const [totalFollowUps, todayFollowUps, pendingFollowUps, dueToday, totalCustomers] = await Promise.all([
    prisma.demandRecord.count({
      where: {
        followUpDate: { not: null },
        ...rangeWhere,
      },
    }),
    prisma.demandRecord.count({
      where: {
        followUpDate: { not: null },
        createdAt: { gte: startOfToday },
      },
    }),
    prisma.demandRecord.count({
      where: {
        followUpDate: { not: null },
        status: { notIn: ["closed", "completed"] },
        ...rangeWhere,
      },
    }),
    prisma.demandRecord.count({
      where: {
        followUpDate: { gte: startOfToday, lt: endOfToday },
      },
    }),
    prisma.customer.count({
      where: rangeWhere.createdAt ? { createdAt: rangeWhere.createdAt } : {},
    }),
  ]);

  return NextResponse.json({
    totalFollowUps,
    todayFollowUps,
    pendingFollowUps,
    dueToday,
    totalCustomers,
  });
}