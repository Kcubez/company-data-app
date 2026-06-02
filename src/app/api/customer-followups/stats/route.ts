import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/customer-followups/stats — customer followup specific stats
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const [totalFollowUps, todayFollowUps, pendingFollowUps, dueToday, totalCustomers] = await Promise.all([
    prisma.demandRecord.count({ where: { reportType: "customer_follow_up" } }),
    prisma.demandRecord.count({
      where: {
        reportType: "customer_follow_up",
        createdAt: { gte: startOfToday },
      },
    }),
    prisma.demandRecord.count({
      where: { reportType: "customer_follow_up", status: "pending" },
    }),
    prisma.demandRecord.count({
      where: {
        reportType: "customer_follow_up",
        followUpDate: { gte: startOfToday, lt: endOfToday },
      },
    }),
    prisma.customer.count(),
  ]);

  return NextResponse.json({
    totalFollowUps,
    todayFollowUps,
    pendingFollowUps,
    dueToday,
    totalCustomers,
  });
}