import { auth } from "@/lib/auth";
import type { Prisma } from "@/generated/prisma/client";
import { buildBusinessInsights } from "@/lib/demand-analysis";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { senderOwnedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  // This page represents Sales & Marketing only. Customer-service purchase
  // history is stored in the same table but must not inflate sales rankings.
  const rangeWhere: Prisma.DemandRecordWhereInput = {
    reportType: "demand_report",
    ...senderOwnedByUserOrAdmin(session),
    ...notDeleted,
  };
  if (dateFrom || dateTo) {
    rangeWhere.createdAt = {};
    if (dateFrom) rangeWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) rangeWhere.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }
  const soldServiceWhere: Prisma.DemandRecordWhereInput = {
    serviceName: { not: null },
    status: { in: ['closed', 'completed'] },
    ...senderOwnedByUserOrAdmin(session),
    ...notDeleted,
  };
  if (dateFrom || dateTo) {
    soldServiceWhere.createdAt = {};
    if (dateFrom) soldServiceWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) soldServiceWhere.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }
  const servicePurchaseWhere: Prisma.DemandRecordWhereInput = {
    reportType: "customer_service",
    ...senderOwnedByUserOrAdmin(session),
    ...notDeleted,
  };
  if (dateFrom || dateTo) {
    servicePurchaseWhere.createdAt = {};
    if (dateFrom) servicePurchaseWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) servicePurchaseWhere.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
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
    "AI automation book",
    "Prompt Packs ebook",
    "Other",
  ];

  const [
    totalRecords,
    todayRecords,
    serviceGroups,
    priorityGroups,
    analysisRecords,
    uniqueCustomerRows,
    serviceRevenueRows,
    totalPurchaseRecords,
  ] = await Promise.all([
    prisma.demandRecord.count({ where: rangeWhere }),
    prisma.demandRecord.count({ where: { createdAt: { gte: startOfToday }, ...senderOwnedByUserOrAdmin(session), ...notDeleted } }),
    prisma.demandRecord.groupBy({
      by: ['serviceName'],
      where: soldServiceWhere,
      _count: { _all: true },
      _sum: {
        serviceQty: true,
        serviceAmount: true,
      },
    }),
    prisma.demandRecord.groupBy({
      by: ['priority'],
      where: {
        status: { notIn: ['closed', 'completed'] },
        ...rangeWhere,
      },
      _count: { _all: true },
    }),
    prisma.demandRecord.findMany({
      where: {
        status: { notIn: ['closed', 'completed'] },
        ...rangeWhere,
      },
      orderBy: [{ priority: 'asc' }, { potentialScore: 'desc' }],
      take: 200,
      select: {
        customerName: true,
        serviceName: true,
        serviceAmount: true,
        serviceQty: true,
        followUpDate: true,
        followUpStatus: true,
        status: true,
        note: true,
        priority: true,
        potentialScore: true,
        priorityReason: true,
        recommendedAction: true,
        missingFields: true,
        customer: { select: { phone: true, company: true } },
      },
    }),
    prisma.demandRecord.findMany({
      where: { customerId: { not: null }, ...rangeWhere },
      select: { customerId: true },
      distinct: ['customerId'],
    }),
    prisma.demandRecord.findMany({
      where: soldServiceWhere,
      select: { serviceName: true, serviceAmount: true, serviceQty: true },
    }),
    prisma.demandRecord.count({ where: servicePurchaseWhere }),
  ]);

  const revenueByService = new Map<string, number>();
  const quantityByService = new Map<string, number>();
  for (const record of serviceRevenueRows) {
    if (record.serviceName) {
      revenueByService.set(
        record.serviceName,
        (revenueByService.get(record.serviceName) ?? 0) + (record.serviceAmount ?? 0) * (record.serviceQty ?? 1),
      );
      quantityByService.set(
        record.serviceName,
        (quantityByService.get(record.serviceName) ?? 0) + (record.serviceQty ?? 1),
      );
    }
  }

  const serviceStatsMap = new Map<string, { count: number; totalQty: number; revenue: number }>();
  for (const row of serviceGroups) {
    if (row.serviceName) {
      serviceStatsMap.set(row.serviceName, {
        count: row._count._all,
        totalQty: quantityByService.get(row.serviceName) ?? 0,
        revenue: revenueByService.get(row.serviceName) ?? 0,
      });
    }
  }

  const servicesStats = allowedServices.map((service) => {
    const stats = serviceStatsMap.get(service) || { count: 0, totalQty: 0, revenue: 0 };
    return {
      serviceName: service,
      // A demand row may contain more than one unit. The Sales & Marketing
      // card calls this value "sales", so it must use Service Qty—not rows.
      salesCount: stats.totalQty,
      totalQty: stats.totalQty,
      revenue: stats.revenue,
    };
  });

  // Rank by sales volume, then use revenue to break ties.
  servicesStats.sort((a, b) => {
    if (b.salesCount !== a.salesCount) {
      return b.salesCount - a.salesCount;
    }
    if (b.revenue !== a.revenue) {
      return b.revenue - a.revenue;
    }
    return allowedServices.indexOf(a.serviceName) - allowedServices.indexOf(b.serviceName);
  });

  const priority = { high: 0, medium: 0, low: 0 };
  for (const group of priorityGroups) {
    if (group.priority in priority) {
      priority[group.priority as keyof typeof priority] = group._count._all;
    }
  }

  const insightRecords = analysisRecords.map((record) => ({
    customerName: record.customerName,
    customerPhone: record.customer?.phone ?? null,
    customerCompany: record.customer?.company ?? null,
    serviceName: record.serviceName,
    serviceAmount: record.serviceAmount,
    serviceQty: record.serviceQty,
    followUpDate: record.followUpDate,
    status: record.status,
    note: record.note,
    createdAt: null,
    priority: record.priority as "high" | "medium" | "low",
    potentialScore: record.potentialScore,
    priorityReason: record.priorityReason || "",
    recommendedAction: record.recommendedAction || "",
    missingFields: record.missingFields,
    followUpStatus: record.followUpStatus as "due" | "scheduled" | "overdue" | "not_scheduled",
  }));

  return NextResponse.json({
    totalRecords,
    todayRecords,
    totalPurchaseRecords,
    services: servicesStats,
    priority,
    insights: buildBusinessInsights(insightRecords),
    uniqueCustomers: uniqueCustomerRows.length,
  });
}
