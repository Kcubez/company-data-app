import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();

  const { status, remark } = body;

  try {
    const record = await prisma.websiteUpdate.update({
      where: { id },
      data: {
        status: status !== undefined ? status : undefined,
        remark: remark !== undefined ? remark : undefined,
      },
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
    await prisma.websiteUpdate.delete({
      where: { id },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting website update record:", error);
    return NextResponse.json({ message: "Record not found" }, { status: 404 });
  }
}
