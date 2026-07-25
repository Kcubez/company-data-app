import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted, softDeleteData } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { financeEntrySchema } from "@/lib/validations";
import { NextRequest, NextResponse } from "next/server";

function toNullable(value: string | null | undefined) {
  return value?.trim() || null;
}

// PATCH /api/finance-entries/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const existing = await prisma.financeEntry.findFirst({
    where: { id, ...uploadedByUserOrAdmin(session), ...notDeleted },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ message: "Finance entry not found" }, { status: 404 });

  const body = await req.json();
  const parsed = financeEntrySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 400 });

  const data = parsed.data;
  const entry = await prisma.financeEntry.update({
    where: { id },
    data: {
      ...data,
      counterparty: toNullable(data.counterparty),
      voucherNumber: toNullable(data.voucherNumber),
      notes: toNullable(data.notes),
    },
  });
  return NextResponse.json({ entry });
}

// DELETE /api/finance-entries/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await prisma.financeEntry.updateMany({
    where: { id, ...uploadedByUserOrAdmin(session), ...notDeleted },
    data: softDeleteData(session.user.id),
  });
  if (result.count === 0) return NextResponse.json({ message: "Finance entry not found" }, { status: 404 });
  return NextResponse.json({ success: true });
}
