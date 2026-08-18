import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const dateFrom = req.nextUrl.searchParams.get("dateFrom");
  const dateTo = req.nextUrl.searchParams.get("dateTo");
  const periodWhere: Prisma.WebsiteUpdateWhereInput = {};
  if (dateFrom || dateTo) {
    periodWhere.createdAt = {};
    if (dateFrom) periodWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) periodWhere.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  const websites = await prisma.websiteUpdate.findMany({
    where: { status: { in: ["pending_update", "in_progress"] }, ...periodWhere, ...uploadedByUserOrAdmin(session), ...notDeleted },
    orderBy: { updatedAt: "asc" },
    take: 15,
  });
  const now = Date.now();
  const recommendations = websites.slice(0, 5).map((website) => {
    const daysWaiting = Math.max(0, Math.floor((now - website.updatedAt.getTime()) / 86_400_000));
    const packageName = website.packageName ? `${website.packageName} package` : "Website";
    const insight = website.status === "pending_update"
      ? `${packageName} Update လုပ်ရန် ${daysWaiting} ရက် ကျန်ရှိနေပါသည် — Developer တာဝန်သတ်မှတ်ပြီး ပြီးစီးရမည့်ရက်ကို အတည်ပြုပါ။`
      : `Update လုပ်ငန်းစဉ် ${daysWaiting} ရက် ဆက်လက်လုပ်ဆောင်နေသည် — Developer ထံမှ လက်ရှိ Progress နှင့် ပြီးစီးရက်ကို အတည်ပြုပါ။`;
    return { websiteName: website.name, insight };
  });

  return NextResponse.json({ recommendations, source: "local" });
}
