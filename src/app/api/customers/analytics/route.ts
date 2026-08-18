import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { customerOwnedByUserOrAdmin } from "@/lib/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

type CustomerMetric = {
  id: string;
  name: string;
  company: string | null;
  totalSpend: number;
  lifetimeValue: number;
  purchaseFrequency: number;
  averageOrderValue: number;
  lastPurchaseAt: string | null;
  segment: "vip" | "frequent" | "at_risk" | "new" | "standard";
};

const amountFor = (record: { serviceAmount: number | null; serviceQty: number | null }) =>
  (record.serviceAmount ?? 0) * (record.serviceQty ?? 1);

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const dateFrom = searchParams.get("dateFrom");
  const dateTo = searchParams.get("dateTo");
  const dateFilter: Prisma.DemandRecordWhereInput = { ...notDeleted };
  if (dateFrom || dateTo) {
    dateFilter.createdAt = {};
    if (dateFrom) dateFilter.createdAt.gte = new Date(dateFrom);
    if (dateTo) dateFilter.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  const customers = await prisma.customer.findMany({
    where: { ...customerOwnedByUserOrAdmin(session), ...notDeleted },
    select: {
      id: true,
      name: true,
      company: true,
      demandRecords: {
        where: notDeleted,
        select: { serviceAmount: true, serviceQty: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  const now = new Date();
  const metrics: CustomerMetric[] = customers.map((customer) => {
    const all = customer.demandRecords;
    const selected = all.filter((record) => {
      if (dateFrom && record.createdAt < new Date(dateFrom)) return false;
      if (dateTo && record.createdAt > new Date(`${dateTo}T23:59:59.999Z`)) return false;
      return true;
    });
    const totalSpend = selected.reduce((sum, record) => sum + amountFor(record), 0);
    const lifetimeValue = all.reduce((sum, record) => sum + amountFor(record), 0);
    const lastPurchase = all[0]?.createdAt ?? null;
    const daysSincePurchase = lastPurchase ? Math.floor((now.getTime() - lastPurchase.getTime()) / 86_400_000) : Infinity;
    const purchaseFrequency = selected.length;
    const averageOrderValue = purchaseFrequency ? totalSpend / purchaseFrequency : 0;
    const segment: CustomerMetric["segment"] = lifetimeValue > 0 && purchaseFrequency >= 3
      ? "vip"
      : purchaseFrequency >= 2
        ? "frequent"
        : lifetimeValue > 0 && daysSincePurchase > 90
          ? "at_risk"
          : purchaseFrequency === 1
            ? "new"
            : "standard";
    return { id: customer.id, name: customer.name, company: customer.company, totalSpend, lifetimeValue, purchaseFrequency, averageOrderValue, lastPurchaseAt: lastPurchase?.toISOString() ?? null, segment };
  });

  const active = metrics.filter((customer) => customer.purchaseFrequency > 0 || customer.lifetimeValue > 0);
  const topSorted = [...active].sort((a, b) => b.totalSpend - a.totalSpend || b.lifetimeValue - a.lifetimeValue);
  const bottomSorted = [...active].sort((a, b) => a.totalSpend - b.totalSpend || a.lifetimeValue - b.lifetimeValue);
  const top20 = topSorted.slice(0, 20);
  const bottom20 = bottomSorted.slice(0, 20);
  const comparisonSize = Math.min(20, Math.ceil(active.length / 2));
  const topComparison = topSorted.slice(0, comparisonSize);
  const bottomComparison = bottomSorted.slice(0, comparisonSize);
  const average = (items: CustomerMetric[]) => items.length ? items.reduce((sum, customer) => sum + customer.totalSpend, 0) / items.length : 0;
  const vipCount = active.filter((customer) => customer.segment === "vip").length;
  const atRisk = active.filter((customer) => customer.segment === "at_risk");
  const newCustomers = active.filter((customer) => customer.segment === "new").length;

  const recommendations = [
    ...(vipCount > 0 ? [{ tone: "success", title: "VIP သုံးစွဲသူများကို ဆက်လက်ထိန်းသိမ်းပါ", message: `ယခုကာလအတွင်း ${vipCount} ဦးသည် (၃) ကြိမ်နှင့်အထက် ဝယ်ယူထားပါသည်။ ထပ်မံဝယ်ယူမှုရရှိစေရန် သက်တမ်းတိုးခြင်း၊ Loyalty အကျိုးခံစားခွင့် သို့မဟုတ် ဦးစားပေးဝန်ဆောင်မှု ပေးပါ။`, action: "Top 20 စာရင်းကို စစ်ဆေးရန်" }] : []),
    ...(atRisk.length > 0 ? [{ tone: "warning", title: "ဝယ်ယူမှုရပ်ထားသော သုံးစွဲသူများကို ပြန်လည်ဆက်သွယ်ပါ", message: `${atRisk.length} ဦးတွင် ဝယ်ယူမှုမှတ်တမ်းရှိသော်လည်း ရက် (၉၀) ကျော် လှုပ်ရှားမှုမရှိသေးပါ။`, action: "အန္တရာယ်ရှိသည့် သုံးစွဲသူများကို စစ်ဆေးရန်" }] : []),
    ...(newCustomers > 0 ? [{ tone: "info", title: "အသစ်ဝယ်ယူသူများကို ထပ်မံဝယ်ယူသူအဖြစ် ပြောင်းလဲပါ", message: `ယခုကာလအတွင်း ${newCustomers} ဦးက ပထမဆုံး ဝယ်ယူမှု ပြုလုပ်ထားပါသည်။ ဝယ်ယူပြီးနောက် follow-up ဆက်သွယ်ပြီး သင့်တော်သော နောက်ထပ် offer ကို အကြံပြုပါ။`, action: "အသစ်ဝယ်ယူသူများကို စစ်ဆေးရန်" }] : []),
    ...(active.length > 0 ? [{ tone: "info", title: "ဝယ်ယူမှုအကြိမ်ရေ တိုးတက်အောင် လုပ်ဆောင်ပါ", message: `လက်ရှိ သုံးစွဲသူတစ်ဦးလျှင် ပျမ်းမျှ ${active.length ? (active.reduce((sum, customer) => sum + customer.purchaseFrequency, 0) / active.length).toFixed(1) : "0"} ကြိမ် ဝယ်ယူထားပါသည်။ သက်ဆိုင်ရာ service များကို အစုလိုက် offer ဖြင့် အကြံပြုပေးပါ။`, action: "သုံးစွဲသူအချက်အလက်ကို စစ်ဆေးရန်" }] : []),
  ].slice(0, 2);

  return NextResponse.json({
    top20,
    bottom20,
    summary: {
      totalCustomers: active.length,
      top20AverageSpend: average(topComparison),
      bottom20AverageSpend: average(bottomComparison),
      averageLifetimeValue: active.length ? active.reduce((sum, customer) => sum + customer.lifetimeValue, 0) / active.length : 0,
      averagePurchaseFrequency: active.length ? active.reduce((sum, customer) => sum + customer.purchaseFrequency, 0) / active.length : 0,
      atRiskCustomers: atRisk.length,
    },
    recommendations,
  });
}
