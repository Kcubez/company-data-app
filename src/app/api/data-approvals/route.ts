import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { senderOwnedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

// GET /api/data-approvals — audit trail for Telegram file submissions.
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const approvals = await prisma.pendingDemandImport.findMany({
    where: senderOwnedByUserOrAdmin(session),
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      fileName: true,
      fileType: true,
      reportType: true,
      status: true,
      reviewNote: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
      summary: true,
      sender: {
        select: { displayName: true, firstName: true, lastName: true, email: true },
      },
      approver: {
        select: { displayName: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  const summary = {
    awaitingReview: approvals.filter((item) =>
      item.status === "pending_owner_review" || item.status === "awaiting_rejection_reason",
    ).length,
    approved: approvals.filter((item) => item.status === "approved").length,
    rejected: approvals.filter((item) => item.status === "rejected").length,
  };

  return NextResponse.json({ approvals, summary });
}
