import { auth } from "@/lib/auth";
import type { Prisma, ProjectExpiration } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { notDeleted, softDeleteData } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

function serializeProjectExpiration(record: ProjectExpiration) {
  const result: Record<string, unknown> = { ...record };
  if (result.domainExpireDate instanceof Date) result.domainExpireDate = result.domainExpireDate.toISOString();
  if (result.hostingExpireDate instanceof Date) result.hostingExpireDate = result.hostingExpireDate.toISOString();
  if (result.offerExpireDate instanceof Date) result.offerExpireDate = result.offerExpireDate.toISOString();
  if (result.createdAt instanceof Date) result.createdAt = result.createdAt.toISOString();
  if (result.updatedAt instanceof Date) result.updatedAt = result.updatedAt.toISOString();
  return result;
}

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const search = searchParams.get("search") || "";
  const filter = searchParams.get("filter") || "all"; // "all" | "expired" | "expiring_soon" | "active"
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const where: Prisma.ProjectExpirationWhereInput = { ...uploadedByUserOrAdmin(session), ...notDeleted };

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  const filters: Prisma.ProjectExpirationWhereInput[] = [];

  if (search) {
    filters.push({ OR: [
      { projectName: { contains: search, mode: "insensitive" } },
      { url: { contains: search, mode: "insensitive" } },
      { domainProvider: { contains: search, mode: "insensitive" } },
      { hostingProvider: { contains: search, mode: "insensitive" } },
      { remark: { contains: search, mode: "insensitive" } },
    ] });
  }

  const now = new Date();
  const next30Days = new Date();
  next30Days.setDate(now.getDate() + 30);

  if (filter === "expired") {
    filters.push({ OR: [
      { domainExpireDate: { lt: now } },
      { hostingExpireDate: { lt: now } },
      { offerExpireDate: { lt: now } },
    ] });
  } else if (filter === "expiring_soon") {
    filters.push({ OR: [
      {
        domainExpireDate: {
          gte: now,
          lte: next30Days,
        },
      },
      {
        hostingExpireDate: {
          gte: now,
          lte: next30Days,
        },
      },
      {
        offerExpireDate: {
          gte: now,
          lte: next30Days,
        },
      },
    ] });
  } else if (filter === "active") {
    filters.push({ AND: [
      {
        OR: [
          { domainExpireDate: { gt: next30Days } },
          { domainExpireDate: null },
        ],
      },
      {
        OR: [
          { hostingExpireDate: { gt: next30Days } },
          { hostingExpireDate: null },
        ],
      },
      {
        OR: [
          { offerExpireDate: { gt: next30Days } },
          { offerExpireDate: null },
        ],
      },
    ] });
  } else if (filter === "maintenance" || filter === "finished") {
    filters.push({ projectStatus: filter });
  }

  if (filters.length > 0) {
    where.AND = filters;
  }

  const [records, total, stats] = await Promise.all([
    prisma.projectExpiration.findMany({
      where,
      orderBy: [
        { domainExpireDate: "asc" },
        { hostingExpireDate: "asc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.projectExpiration.count({ where }),
    prisma.$transaction(async (tx) => {
      const statsWhere: Prisma.ProjectExpirationWhereInput = { ...uploadedByUserOrAdmin(session), ...notDeleted };
      if (dateFrom || dateTo) {
        statsWhere.createdAt = {};
        if (dateFrom) statsWhere.createdAt.gte = new Date(dateFrom);
        if (dateTo) statsWhere.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
      }

      const all = await tx.projectExpiration.findMany({
        where: statsWhere,
        select: {
          domainExpireDate: true,
          hostingExpireDate: true,
          offerExpireDate: true,
        },
      });

      let expiredCount = 0;
      let expiringSoonCount = 0;
      let activeCount = 0;

      for (const item of all) {
        const hasExpired =
          (item.domainExpireDate && item.domainExpireDate < now) ||
          (item.hostingExpireDate && item.hostingExpireDate < now) ||
          (item.offerExpireDate && item.offerExpireDate < now);

        const isExpiringSoon =
          !hasExpired &&
          ((item.domainExpireDate && item.domainExpireDate >= now && item.domainExpireDate <= next30Days) ||
            (item.hostingExpireDate && item.hostingExpireDate >= now && item.hostingExpireDate <= next30Days) ||
            (item.offerExpireDate && item.offerExpireDate >= now && item.offerExpireDate <= next30Days));

        if (hasExpired) {
          expiredCount++;
        } else if (isExpiringSoon) {
          expiringSoonCount++;
        } else {
          activeCount++;
        }
      }

      return {
        total: all.length,
        expired: expiredCount,
        expiringSoon: expiringSoonCount,
        active: activeCount,
      };
    }),
  ]);

  return NextResponse.json({
    records: records.map(serializeProjectExpiration),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    stats,
  });
}

// DELETE /api/project-expiries
// Admin: deletes all records.
// Regular user: soft-deletes only rows they own.
export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const where: Prisma.ProjectExpirationWhereInput = { ...uploadedByUserOrAdmin(session), ...notDeleted };

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  const result = await prisma.projectExpiration.updateMany({
    where,
    data: softDeleteData(session.user.id, searchParams.get("reason")),
  });
  return NextResponse.json({ success: true, deleted: result.count });
}
