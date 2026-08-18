import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { differenceInDays } from "date-fns";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  const dateFrom = req.nextUrl.searchParams.get("dateFrom");
  const dateTo = req.nextUrl.searchParams.get("dateTo");
  const periodWhere: Prisma.ProjectExpirationWhereInput = {};
  if (dateFrom || dateTo) {
    periodWhere.createdAt = {};
    if (dateFrom) periodWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) periodWhere.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  const today = new Date();
  const projects = await prisma.projectExpiration.findMany({
    where: { ...periodWhere, ...uploadedByUserOrAdmin(session), ...notDeleted },
    take: 20,
  });
  const recommendations = projects
    .map((project) => {
      const dates = [project.domainExpireDate, project.hostingExpireDate].filter((date): date is Date => Boolean(date));
      const days = dates.length ? Math.min(...dates.map((date) => differenceInDays(date, today))) : null;
      const provider = project.domainProvider || project.hostingProvider || "provider";
      const insight = days === null
        ? "Domain နှင့် Hosting သက်တမ်းကုန်ရက် မသတ်မှတ်ရသေးပါ — ရက်စွဲများကို မှတ်တမ်းတင်ပါ။"
        : days < 0
          ? `Domain သို့မဟုတ် Hosting သက်တမ်းကုန်ဆုံးသွားပါပြီ — ${provider} မှတစ်ဆင့် ချက်ချင်း သက်တမ်းတိုးပါ။`
          : days === 0
            ? `ယနေ့ သက်တမ်းကုန်ဆုံးမည် — ${provider} သို့ ဆက်သွယ်ပြီး ချက်ချင်း သက်တမ်းတိုးပါ။`
            : days <= 15
              ? `သက်တမ်းကုန်ဆုံးရန် ${days} ရက်သာ ကျန်ရှိသည် — ${provider} နှင့် Renewal ကို ယနေ့ အတည်ပြုပါ။`
              : `သက်တမ်းကုန်ဆုံးရန် ${days} ရက် ကျန်ရှိသည် — Renewal အစီအစဉ်ကို စောစောပြင်ဆင်ပါ။`;
      return { projectName: project.projectName, insight, days: days ?? Number.MAX_SAFE_INTEGER };
    })
    .sort((a, b) => a.days - b.days)
    .slice(0, 5)
    .map(({ projectName, insight }) => ({ projectName, insight }));

  return NextResponse.json({ recommendations, source: "local" });
}
