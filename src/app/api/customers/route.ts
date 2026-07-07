import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const search = searchParams.get("search") || "";
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const status = searchParams.get("status") || "";

  const where: Record<string, any> = {};
  const conditions: any[] = [];

  if (status) where.status = status;
  if (dateFrom || dateTo) {
    const rangeCondition: Record<string, Date> = {};
    if (dateFrom) rangeCondition.gte = new Date(dateFrom);
    if (dateTo) rangeCondition.lte = new Date(dateTo + "T23:59:59.999Z");
    
    conditions.push({
      OR: [
        { createdAt: rangeCondition },
        { demandRecords: { some: { createdAt: rangeCondition } } },
        { activities: { some: { createdAt: rangeCondition } } }
      ]
    });
  }
  if (search) {
    conditions.push({
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search, mode: "insensitive" } },
        { company: { contains: search, mode: "insensitive" } },
      ]
    });
  }

  if (conditions.length > 0) {
    where.AND = conditions;
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        activities: {
          include: {
            sender: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        demandRecords: {
          select: {
            id: true,
            serviceName: true,
            serviceAmount: true,
            status: true,
          }
        },
        _count: {
          select: { demandRecords: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.customer.count({ where }),
  ]);

  const serialized = customers.map((c) => ({
    ...c,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    activities: c.activities.map((a) => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
      sender: a.sender
        ? {
            ...a.sender,
            telegramUserId: a.sender.telegramUserId ? a.sender.telegramUserId.toString() : null,
            lastMessageAt: a.sender.lastMessageAt?.toISOString() ?? null,
            createdAt: a.sender.createdAt.toISOString(),
            updatedAt: a.sender.updatedAt.toISOString(),
          }
        : null,
    })),
  }));

  return NextResponse.json({
    customers: serialized,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}

function normalizeCustomerName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { name, phone, email, company, notes } = body;

  if (!name) {
    return NextResponse.json({ message: "Name is required" }, { status: 400 });
  }

  const customer = await prisma.customer.create({
    data: {
      name,
      nameNormalized: normalizeCustomerName(name),
      phone,
      email,
      company,
      notes,
    },
  });

  return NextResponse.json({ customer });
}

export async function PATCH(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { id, name, phone, email, company, notes, status } = body;

  if (!id) {
    return NextResponse.json({ message: "ID is required" }, { status: 400 });
  }

  const data: Record<string, unknown> = { phone, email, company, notes, status };
  if (typeof name === "string" && name.length > 0) {
    data.name = name;
    data.nameNormalized = normalizeCustomerName(name);
  }

  const customer = await prisma.customer.update({
    where: { id },
    data,
  });

  return NextResponse.json({ customer });
}

// DELETE /api/customers — remove customers matching the selected period.
// CustomerActivity cascades; DemandRecord.customerId is set to null (see schema).
export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const dateFrom = searchParams.get("dateFrom") || "";
  const dateTo = searchParams.get("dateTo") || "";
  const where: Record<string, any> = {};

  if (dateFrom || dateTo) {
    const rangeCondition: Record<string, Date> = {};
    if (dateFrom) rangeCondition.gte = new Date(dateFrom);
    if (dateTo) rangeCondition.lte = new Date(dateTo + "T23:59:59.999Z");

    where.OR = [
      { createdAt: rangeCondition },
      { demandRecords: { some: { createdAt: rangeCondition } } },
      { activities: { some: { createdAt: rangeCondition } } },
    ];
  }

  const result = await prisma.customer.deleteMany({ where });
  return NextResponse.json({ success: true, count: result.count });
}
