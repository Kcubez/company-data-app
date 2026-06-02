import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      activities: {
        include: {
          sender: true,
        },
        orderBy: { createdAt: "desc" },
      },
      demandRecords: {
        include: {
          sender: true,
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!customer) {
    return NextResponse.json({ message: "Customer not found" }, { status: 404 });
  }

  const timeline = [
    ...customer.activities.map((a) => ({
      id: a.id,
      type: "activity" as const,
      action: a.action,
      description: a.description,
      sender: a.sender?.displayName,
      senderId: a.senderId,
      createdAt: a.createdAt.toISOString(),
    })),
    ...customer.demandRecords.map((d) => ({
      id: d.id,
      type: "demand" as const,
      reportType: d.reportType,
      customerName: d.customerName,
      category: d.category,
      status: d.status,
      note: d.note,
      followUpDate: d.followUpDate?.toISOString(),
      sender: d.sender?.displayName,
      senderId: d.senderId,
      createdAt: d.createdAt.toISOString(),
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return NextResponse.json({
    customer: {
      ...customer,
      createdAt: customer.createdAt.toISOString(),
      updatedAt: customer.updatedAt.toISOString(),
    },
    timeline,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { name, phone, email, company, notes, status } = body;

  const customer = await prisma.customer.update({
    where: { id },
    data: { name, phone, email, company, notes, status },
  });

  return NextResponse.json({ customer });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await prisma.customer.delete({ where: { id } });

  return NextResponse.json({ success: true });
}