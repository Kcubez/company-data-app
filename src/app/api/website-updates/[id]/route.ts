import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted, softDeleteData } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const existing = await prisma.websiteUpdate.findFirst({
    where: { id, ...uploadedByUserOrAdmin(session), ...notDeleted },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ message: "Record not found or access denied" }, { status: 404 });
  }

  const allowed = ["name", "url", "businessType", "packageName", "status", "remark"] as const;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  for (const key of allowed) {
    if (key in body) {
      data[key] = body[key] === "" ? null : body[key];
    }
  }

  if (data.name !== undefined && typeof data.name === "string" && !data.name.trim()) {
    return NextResponse.json({ message: "Website name is required" }, { status: 400 });
  }

  try {
    const record = await prisma.websiteUpdate.update({
      where: { id },
      data,
    });

    const serialized = {
      ...record,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };

    return NextResponse.json(serialized);
  } catch (error) {
    console.error("Error updating website update status:", error);
    return NextResponse.json({ message: "Record not found or update failed" }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await prisma.websiteUpdate.updateMany({
      where: { id, ...uploadedByUserOrAdmin(session), ...notDeleted },
      data: softDeleteData(session.user.id),
    });
    if (result.count === 0) {
      return NextResponse.json({ message: "Record not found or access denied" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting website update record:", error);
    return NextResponse.json({ message: "Record not found" }, { status: 404 });
  }
}
