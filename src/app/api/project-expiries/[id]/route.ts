import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { NextRequest, NextResponse } from "next/server";

function serializeProjectExpiration(record: Record<string, unknown>) {
  const result = { ...record };
  if (result.domainExpireDate instanceof Date) result.domainExpireDate = result.domainExpireDate.toISOString();
  if (result.hostingExpireDate instanceof Date) result.hostingExpireDate = result.hostingExpireDate.toISOString();
  if (result.offerExpireDate instanceof Date) result.offerExpireDate = result.offerExpireDate.toISOString();
  if (result.createdAt instanceof Date) result.createdAt = result.createdAt.toISOString();
  if (result.updatedAt instanceof Date) result.updatedAt = result.updatedAt.toISOString();
  return result;
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
  const existing = await prisma.projectExpiration.findFirst({
    where: { id, ...uploadedByUserOrAdmin(session), ...notDeleted },
    select: { id: true },
  });
  if (!existing) {
    return NextResponse.json({ message: "Record not found or access denied" }, { status: 404 });
  }

  const allowedFields = [
    "projectName",
    "url",
    "packageName",
    "domainProvider",
    "hostingProvider",
    "hostingRemark",
    "domainExpireDate",
    "hostingExpireDate",
    "offerExpireDate",
    "projectStatus",
    "remark",
  ] as const;

  const data: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (field in body) {
      if (field === "domainExpireDate" || field === "hostingExpireDate" || field === "offerExpireDate") {
        data[field] = body[field] ? new Date(body[field]) : null;
      } else {
        data[field] = body[field] === "" ? null : body[field];
      }
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ message: "No valid fields to update" }, { status: 400 });
  }

  try {
    const updated = await prisma.projectExpiration.update({
      where: { id },
      data,
    });
    return NextResponse.json(serializeProjectExpiration(updated as Record<string, unknown>));
  } catch {
    return NextResponse.json({ message: "Record not found or update failed" }, { status: 404 });
  }
}
