import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { hasValidStaffDepartments } from "@/lib/staff-departments";
import { ownedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

// GET /api/hr/staff — list all staff members & department metrics
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const scope = ownedByUserOrAdmin(session);
  const senders = await prisma.telegramSender.findMany({
    where: scope,
    orderBy: [{ isAuthorized: "desc" }, { lastMessageAt: "desc" }, { createdAt: "desc" }],
  });

  const formattedSenders = senders.map((s) => ({
    ...s,
    telegramUserId: s.telegramUserId ? s.telegramUserId.toString() : null,
  }));

  const totalStaff = formattedSenders.length;
  const authorizedStaff = formattedSenders.filter(
    (s) => s.isAuthorized && s.isVerified
  ).length;
  const pendingStaff = formattedSenders.filter(
    (s) => s.isAuthorized && !s.isVerified
  ).length;

  const departmentCounts = {
    Sales: 0,
    IT: 0,
    Finance: 0,
    QA: 0,
  };

  for (const s of formattedSenders) {
    if (s.isAuthorized && s.isVerified && Array.isArray(s.allowedDepartments)) {
      for (const dep of s.allowedDepartments) {
        if (dep in departmentCounts) {
          departmentCounts[dep as keyof typeof departmentCounts]++;
        }
      }
    }
  }

  return NextResponse.json({
    staff: formattedSenders,
    summary: {
      totalStaff,
      authorizedStaff,
      pendingStaff,
      departmentCounts,
    },
  });
}

// POST /api/hr/staff — pre-authorize / add a new staff member by email & departments
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { email, allowedDepartments } = body;

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return NextResponse.json({ message: "Valid email address is required" }, { status: 400 });
  }

  if (!hasValidStaffDepartments(allowedDepartments)) {
    return NextResponse.json(
      { message: "Assign at least one valid department" },
      { status: 400 }
    );
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Check if sender already exists for this tenant
  const scope = ownedByUserOrAdmin(session);
  const existingSender = await prisma.telegramSender.findFirst({
    where: {
      email: normalizedEmail,
      ...scope,
    },
  });

  if (existingSender) {
    return NextResponse.json(
      { message: "A staff member with this email is already registered" },
      { status: 409 }
    );
  }

  // Create pre-authorized telegram sender record for the staff member
  const newSender = await prisma.telegramSender.create({
    data: {
      email: normalizedEmail,
      isAuthorized: true,
      allowedDepartments,
      displayName: normalizedEmail.split("@")[0],
      userId: session.user.id,
    },
  });

  return NextResponse.json({
    sender: {
      ...newSender,
      telegramUserId: newSender.telegramUserId ? newSender.telegramUserId.toString() : null,
    },
  });
}
