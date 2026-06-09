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
  const status = searchParams.get("status") || "";

  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { phone: { contains: search, mode: "insensitive" } },
      { company: { contains: search, mode: "insensitive" } },
    ];
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
            telegramUserId: a.sender.telegramUserId.toString(),
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

