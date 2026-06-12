import { auth } from "@/lib/auth";
import { analyzeDemandRecord } from "@/lib/demand-analysis";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

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

  const allowedFields = ["status", "note", "followUpDate", "recommendedAction", "priority"] as const;
  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      if (field === "followUpDate") {
        data[field] = body[field] ? new Date(body[field]) : null;
        data.followUpStatus = analyzeDemandRecord({
          customerName: null,
          customerPhone: null,
          customerCompany: null,
          serviceName: null,
          serviceAmount: null,
          serviceQty: null,
          followUpDate: data[field] as Date | null,
          status: typeof body.status === "string" ? body.status : "new",
          note: typeof body.note === "string" ? body.note : "",
        }).followUpStatus;
      } else {
        data[field] = body[field];
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "No valid fields to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.demandRecord.update({
      where: { id },
      data,
      include: { sender: true, customer: true },
    });

    // Serialize BigInt / Date fields
    const result = { ...updated } as Record<string, unknown>;
    if (result.followUpDate instanceof Date) result.followUpDate = result.followUpDate.toISOString();
    if (result.createdAt instanceof Date) result.createdAt = result.createdAt.toISOString();
    if (result.updatedAt instanceof Date) result.updatedAt = result.updatedAt.toISOString();
    if (result.sender && typeof result.sender === "object") {
      const sender = { ...(result.sender as Record<string, unknown>) };
      if (typeof sender.telegramUserId === "bigint") sender.telegramUserId = sender.telegramUserId.toString();
      result.sender = sender;
    }

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ message: "Record not found or update failed" }, { status: 404 });
  }
}
