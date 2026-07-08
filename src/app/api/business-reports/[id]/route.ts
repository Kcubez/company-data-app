import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted, softDeleteData } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

// PATCH /api/business-reports/[id]
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const existing = await prisma.businessReport.findFirst({
    where: { id, ...uploadedByUserOrAdmin(session), ...notDeleted },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ message: "Record not found or access denied" }, { status: 404 });

  const allowed = [
    "reportDate", "reporterName", "marketingBudget", "marketingChannel",
    "callsMade", "appointmentsMade", "appointmentsKept", "newLeads",
    "totalDemandCount", "totalSalesAmount", "closedDeals", "pendingDeals", "notes",
    "targetSalesAmount", "targetDemandCount", "targetAppointments",
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  for (const key of allowed) {
    if (key in body) {
      if (key === "reportDate" && body[key]) {
        data[key] = new Date(body[key]);
      } else {
        data[key] = body[key] === "" ? null : body[key];
      }
    }
  }

  const updated = await prisma.businessReport.update({ where: { id }, data });
  return NextResponse.json({ record: updated });
}

// DELETE /api/business-reports/[id]
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const result = await prisma.businessReport.updateMany({
    where: { id, ...uploadedByUserOrAdmin(session), ...notDeleted },
    data: softDeleteData(session.user.id),
  });
  if (result.count === 0) return NextResponse.json({ message: "Record not found or access denied" }, { status: 404 });
  return NextResponse.json({ success: true });
}
