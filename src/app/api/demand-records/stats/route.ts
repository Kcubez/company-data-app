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

  const allowedServices = [
    "Website Gold Package",
    "Website Silver Package",
    "Website Diamond Package",
    "Messenger Sale Bot",
    "Telegram Sale Bot",
    "Genius AutoWriter",
    "Genius Board",
    "SOP Generator",
    "POS",
    "EMS",
    "AI for careers ebook",
    "AI for businesses ebook",
    "Prompt Packs ebook",
    "Other",
  ];

  const [
    totalRecords,
    todayRecords,
    serviceGroups,
  ] = await Promise.all([
    prisma.demandRecord.count(),
    prisma.demandRecord.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.demandRecord.groupBy({
      by: ['serviceName'],
      where: { serviceName: { not: null } },
      _count: { _all: true },
      _sum: {
        serviceQty: true,
        serviceAmount: true,
      },
    }),
  ]);

  const serviceStatsMap = new Map<string, { count: number; totalQty: number; revenue: number }>();
  for (const row of serviceGroups) {
    if (row.serviceName) {
      serviceStatsMap.set(row.serviceName, {
        count: row._count._all,
        totalQty: row._sum.serviceQty || 0,
        revenue: row._sum.serviceAmount || 0,
      });
    }
  }

  const servicesStats = allowedServices.map((service) => {
    const stats = serviceStatsMap.get(service) || { count: 0, totalQty: 0, revenue: 0 };
    return {
      serviceName: service,
      salesCount: stats.count,
      totalQty: stats.totalQty,
      revenue: stats.revenue,
    };
  });

  // Sort by revenue descending, then salesCount, and fallback to predefined order
  servicesStats.sort((a, b) => {
    if (b.revenue !== a.revenue) {
      return b.revenue - a.revenue;
    }
    if (b.salesCount !== a.salesCount) {
      return b.salesCount - a.salesCount;
    }
    return allowedServices.indexOf(a.serviceName) - allowedServices.indexOf(b.serviceName);
  });

  return NextResponse.json({
    totalRecords,
    todayRecords,
    services: servicesStats,
  });
}
