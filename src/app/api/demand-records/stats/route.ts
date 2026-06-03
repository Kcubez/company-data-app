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

  const [
    totalRecords,
    todayRecords,
    businessReports,
    futurePlans,
  ] = await Promise.all([
    prisma.demandRecord.count(),
    prisma.demandRecord.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.demandRecord.count({ where: { reportType: "business_report" } }),
    prisma.demandRecord.count({ where: { reportType: "future_plan" } }),
  ]);

  return NextResponse.json({
    totalRecords,
    todayRecords,
    businessReports,
    futurePlans,
  });
}
