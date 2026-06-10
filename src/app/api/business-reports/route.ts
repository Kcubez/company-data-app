import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/business-reports
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, parseInt(searchParams.get("limit") ?? "20"));
  const channel = searchParams.get("channel") || undefined;
  const dateFrom = searchParams.get("dateFrom") || undefined;
  const dateTo = searchParams.get("dateTo") || undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (channel) where.marketingChannel = channel;
  if (dateFrom || dateTo) {
    where.reportDate = {};
    if (dateFrom) where.reportDate.gte = new Date(dateFrom);
    if (dateTo) where.reportDate.lte = new Date(dateTo + "T23:59:59.999Z");
  }

  const [records, total] = await Promise.all([
    prisma.businessReport.findMany({
      where,
      orderBy: { reportDate: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { sender: { select: { displayName: true, username: true } } },
    }),
    prisma.businessReport.count({ where }),
  ]);

  return NextResponse.json({ records, total, page, limit });
}

// DELETE /api/business-reports — admin deletes all; user deletes own + bot rows
export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const isAdmin = session.user.role === "admin";
  const where = isAdmin
    ? {}
    : { OR: [{ uploadedByUserId: session.user.id }, { uploadedByUserId: null }] };

  const result = await prisma.businessReport.deleteMany({ where });
  return NextResponse.json({ success: true, deleted: result.count });
}
