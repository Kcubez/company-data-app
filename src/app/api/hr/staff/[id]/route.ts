import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidStaffDepartments } from "@/lib/staff-departments";
import { ownedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

// PATCH /api/hr/staff/[id] — update staff departments or authorization status
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
  const { isAuthorized, isDataApprover, allowedDepartments } = body;

  const scope = ownedByUserOrAdmin(session);
  const sender = await prisma.telegramSender.findFirst({
    where: { id, ...scope },
  });

  if (!sender) {
    return NextResponse.json({ message: "Staff member not found" }, { status: 404 });
  }

  if (allowedDepartments !== undefined && !hasValidStaffDepartments(allowedDepartments)) {
    return NextResponse.json(
      { message: "Assign at least one valid department" },
      { status: 400 }
    );
  }

  const nextDepartments = allowedDepartments ?? sender.allowedDepartments;
  const nextAuthorization =
    typeof isAuthorized === "boolean" ? isAuthorized : sender.isAuthorized;
  const nextDataApprover =
    nextAuthorization && typeof isDataApprover === "boolean"
      ? isDataApprover
      : nextAuthorization
        ? sender.isDataApprover
        : false;

  if (nextAuthorization && nextDepartments.length === 0) {
    return NextResponse.json(
      { message: "Authorized staff must have at least one department" },
      { status: 400 }
    );
  }

  const updated = await prisma.telegramSender.update({
    where: { id },
    data: {
      isAuthorized: nextAuthorization,
      isDataApprover: nextDataApprover,
      allowedDepartments: nextDepartments,
    },
  });

  return NextResponse.json({
    sender: {
      ...updated,
      telegramUserId: updated.telegramUserId ? updated.telegramUserId.toString() : null,
    },
  });
}

// DELETE /api/hr/staff/[id] — revoke staff access while preserving their history
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const scope = ownedByUserOrAdmin(session);
  const sender = await prisma.telegramSender.findFirst({
    where: { id, ...scope },
  });

  if (!sender) {
    return NextResponse.json({ message: "Staff member not found" }, { status: 404 });
  }

  await prisma.telegramSender.update({
    where: { id },
    data: {
      isAuthorized: false,
      isDataApprover: false,
      allowedDepartments: [],
      activeReportType: "none",
    },
  });

  return NextResponse.json({ success: true });
}
