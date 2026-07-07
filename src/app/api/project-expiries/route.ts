import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

function serializeProjectExpiration(record: any) {
  const result = { ...record };
  if (result.domainExpireDate instanceof Date) result.domainExpireDate = result.domainExpireDate.toISOString();
  if (result.hostingExpireDate instanceof Date) result.hostingExpireDate = result.hostingExpireDate.toISOString();
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

  const where: any = {};

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  if (search) {
    where.OR = [
      { projectName: { contains: search, mode: "insensitive" } },
      { url: { contains: search, mode: "insensitive" } },
      { domainProvider: { contains: search, mode: "insensitive" } },
      { hostingProvider: { contains: search, mode: "insensitive" } },
      { remark: { contains: search, mode: "insensitive" } },
    ];
  }

  const now = new Date();
  const next30Days = new Date();
  next30Days.setDate(now.getDate() + 30);

  if (filter === "expired") {
    where.OR = [
      { domainExpireDate: { lt: now } },
      { hostingExpireDate: { lt: now } },
    ];
  } else if (filter === "expiring_soon") {
    where.OR = [
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
    ];
  } else if (filter === "active") {
    where.AND = [
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
    ];
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
      const statsWhere: any = {};
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
        },
      });

      let expiredCount = 0;
      let expiringSoonCount = 0;
      let activeCount = 0;

      for (const item of all) {
        const hasExpired =
          (item.domainExpireDate && item.domainExpireDate < now) ||
          (item.hostingExpireDate && item.hostingExpireDate < now);

        const isExpiringSoon =
          !hasExpired &&
          ((item.domainExpireDate && item.domainExpireDate >= now && item.domainExpireDate <= next30Days) ||
            (item.hostingExpireDate && item.hostingExpireDate >= now && item.hostingExpireDate <= next30Days));

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
// Regular user: deletes only rows they uploaded + bot-uploaded rows (uploadedByUserId = null).
export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const isAdmin = session.user.role === "admin";
  const where: any = isAdmin
    ? {}
    : { OR: [{ uploadedByUserId: session.user.id }, { uploadedByUserId: null }] };

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  const result = await prisma.projectExpiration.deleteMany({ where });
  return NextResponse.json({ success: true, deleted: result.count });
}
