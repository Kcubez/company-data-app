import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted, softDeleteData } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

function serializeWebsiteUpdate(record: any) {
  const result = { ...record };
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
  const filterStatus = searchParams.get("status") || "all"; // "all" | "up_to_date" | "pending_update" | "in_progress"
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";

  const where: any = { ...uploadedByUserOrAdmin(session), ...notDeleted };

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { url: { contains: search, mode: "insensitive" } },
      { businessType: { contains: search, mode: "insensitive" } },
      { packageName: { contains: search, mode: "insensitive" } },
      { remark: { contains: search, mode: "insensitive" } },
    ];
  }

  if (filterStatus !== "all") {
    where.status = filterStatus;
  }

  const [records, total, stats] = await Promise.all([
    prisma.websiteUpdate.findMany({
      where,
      orderBy: [
        { status: "desc" }, // Or order by last updated/name
        { updatedAt: "desc" },
      ],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.websiteUpdate.count({ where }),
    prisma.$transaction(async (tx) => {
      const statsWhere: any = { ...uploadedByUserOrAdmin(session), ...notDeleted };
      if (dateFrom || dateTo) {
        statsWhere.createdAt = {};
        if (dateFrom) statsWhere.createdAt.gte = new Date(dateFrom);
        if (dateTo) statsWhere.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
      }

      const all = await tx.websiteUpdate.findMany({
        where: statsWhere,
        select: { status: true },
      });

      let upToDateCount = 0;
      let pendingUpdateCount = 0;
      let inProgressCount = 0;

      for (const item of all) {
        if (item.status === "up_to_date") {
          upToDateCount++;
        } else if (item.status === "pending_update") {
          pendingUpdateCount++;
        } else if (item.status === "in_progress") {
          inProgressCount++;
        }
      }

      return {
        total: all.length,
        upToDate: upToDateCount,
        pendingUpdate: pendingUpdateCount,
        inProgress: inProgressCount,
      };
    }),
  ]);

  return NextResponse.json({
    records: records.map(serializeWebsiteUpdate),
    total,
    page,
    totalPages: Math.ceil(total / limit),
    stats,
  });
}

// DELETE /api/website-updates
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
  const where: any = { ...uploadedByUserOrAdmin(session), ...notDeleted };

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  const result = await prisma.websiteUpdate.updateMany({
    where,
    data: softDeleteData(session.user.id, searchParams.get("reason")),
  });
  return NextResponse.json({ success: true, deleted: result.count });
}
