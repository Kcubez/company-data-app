import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted, softDeleteData } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { financeEntrySchema } from "@/lib/validations";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

const types = new Set(["salary", "cogs", "operating_expense", "payment", "receivable", "debt", "voucher", "owner_capital"]);
const statuses = new Set(["recorded", "pending", "paid", "settled", "overdue"]);

function toNullable(value: string | null | undefined) {
  return value?.trim() || null;
}

// GET /api/finance-entries
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const type = searchParams.get("type");
  const status = searchParams.get("status");
  const where: Prisma.FinanceEntryWhereInput = {
    ...uploadedByUserOrAdmin(session),
    ...notDeleted,
  };

  if (type && types.has(type)) where.type = type;
  if (status && statuses.has(status)) where.status = status;
  if ((dateFrom || dateTo) && type !== "owner_capital") {
    where.entryDate = {};
    if (dateFrom) where.entryDate.gte = new Date(dateFrom);
    if (dateTo) where.entryDate.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  const entries = await prisma.financeEntry.findMany({ where, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }] });
  const sum = (entryType: string, openOnly = false) => entries
    .filter((entry) => entry.type === entryType && (!openOnly || !["paid", "settled"].includes(entry.status)))
    .reduce((total, entry) => total + entry.amount, 0);

  const lifetimeOwnerCapitalEntries = await prisma.financeEntry.findMany({
    where: {
      ...uploadedByUserOrAdmin(session),
      ...notDeleted,
      type: "owner_capital",
    },
    select: { amount: true },
  });
  const lifetimeOwnerCapital = lifetimeOwnerCapitalEntries.reduce((total, entry) => total + entry.amount, 0);

  return NextResponse.json({
    entries,
    summary: {
      salary: sum("salary"),
      cogs: sum("cogs"),
      operatingExpense: sum("operating_expense"),
      payments: sum("payment"),
      receivables: sum("receivable", true),
      debts: sum("debt", true),
      vouchers: entries.filter((entry) => entry.type === "voucher").length,
      ownerCapital: lifetimeOwnerCapital,
    },
  });
}

// POST /api/finance-entries
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const parsed = financeEntrySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ message: parsed.error.issues[0]?.message ?? "Invalid entry" }, { status: 400 });

  const data = parsed.data;
  const entry = await prisma.financeEntry.create({
    data: {
      ...data,
      counterparty: toNullable(data.counterparty),
      voucherNumber: toNullable(data.voucherNumber),
      notes: toNullable(data.notes),
      uploadedByUserId: session.user.id,
    },
  });
  return NextResponse.json({ entry }, { status: 201 });
}

// DELETE /api/finance-entries — soft-delete selected finance entries
export async function DELETE(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const where: Prisma.FinanceEntryWhereInput = {
    ...uploadedByUserOrAdmin(session),
    ...notDeleted,
  };

  if (dateFrom || dateTo) {
    where.entryDate = {};
    if (dateFrom) where.entryDate.gte = new Date(dateFrom);
    if (dateTo) where.entryDate.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  const result = await prisma.financeEntry.updateMany({
    where,
    data: softDeleteData(session.user.id, searchParams.get("reason")),
  });
  return NextResponse.json({ success: true, deleted: result.count });
}
