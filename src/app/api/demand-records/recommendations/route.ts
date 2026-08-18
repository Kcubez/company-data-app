import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { senderOwnedByUserOrAdmin } from "@/lib/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const dateFrom = req.nextUrl.searchParams.get("dateFrom");
  const dateTo = req.nextUrl.searchParams.get("dateTo");
  const periodWhere: Prisma.DemandRecordWhereInput = {};
  if (dateFrom || dateTo) {
    periodWhere.createdAt = {};
    if (dateFrom) periodWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) periodWhere.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  const records = await prisma.demandRecord.findMany({
    where: {
      status: { notIn: ["closed", "completed"] },
      customerName: { not: null },
      ...periodWhere,
      ...senderOwnedByUserOrAdmin(session),
      ...notDeleted,
    },
    orderBy: [{ followUpDate: "asc" }, { createdAt: "desc" }],
    take: 15,
  });

  const now = new Date();
  const recommendations = records
    .sort((a, b) => {
      const priority = (record: typeof a) =>
        record.followUpStatus === "overdue" ? 0 : record.followUpDate && record.followUpDate <= now ? 1 : record.priority === "high" ? 2 : 3;
      return priority(a) - priority(b);
    })
    .slice(0, 5)
    .map((record) => {
      const service = record.serviceName ? `${record.serviceName} ကို စိတ်ဝင်စားနေပါသည်` : "ဝန်ဆောင်မှုအကြောင်း စုံစမ်းမေးမြန်းထားပါသည်";
      const followUp = record.followUpStatus === "overdue"
        ? "Follow-up ရက်ကျော်နေပြီဖြစ်သောကြောင့် ယနေ့ ဆက်သွယ်ပါ"
        : record.followUpDate
          ? `Follow-up ရက်စွဲ ${record.followUpDate.toISOString().slice(0, 10)} မတိုင်မီ ဆက်သွယ်ပါ`
          : "Follow-up ရက်စွဲ သတ်မှတ်ပြီး လိုအပ်ချက်အသေးစိတ် ဆွေးနွေးပါ";
      return { customerName: record.customerName || "အမည်မသိ သုံးစွဲသူ", insight: `${service} — ${followUp}။` };
    });

  return NextResponse.json({ recommendations, source: "local" });
}
