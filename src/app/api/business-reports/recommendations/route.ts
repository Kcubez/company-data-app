import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { senderOwnedByUserOrAdmin, uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import type { Prisma } from "@/generated/prisma/client";
import { NextRequest, NextResponse } from "next/server";

// GET /api/business-reports/recommendations
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  const dateFrom = req.nextUrl.searchParams.get("dateFrom");
  const dateTo = req.nextUrl.searchParams.get("dateTo");
  const periodWhere: Prisma.BusinessReportWhereInput = {};
  if (dateFrom || dateTo) {
    periodWhere.reportDate = {};
    if (dateFrom) periodWhere.reportDate.gte = new Date(dateFrom);
    if (dateTo) periodWhere.reportDate.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }
  const demandWhere: Prisma.DemandRecordWhereInput = {
    ...senderOwnedByUserOrAdmin(session),
    ...notDeleted,
    status: { in: ["closed", "completed"] },
  };
  if (dateFrom || dateTo) {
    demandWhere.createdAt = {};
    if (dateFrom) demandWhere.createdAt.gte = new Date(dateFrom);
    if (dateTo) demandWhere.createdAt.lte = new Date(`${dateTo}T23:59:59.999Z`);
  }

  try {
    // Aggregate last 30 reports for trend analysis
    const [reports, demandRows] = await Promise.all([
      prisma.businessReport.findMany({
        where: { ...periodWhere, ...uploadedByUserOrAdmin(session), ...notDeleted },
        orderBy: { reportDate: "desc" },
        take: 30,
        include: { sender: { select: { displayName: true } } },
      }),
      prisma.demandRecord.findMany({
        where: demandWhere,
        select: { serviceAmount: true, serviceQty: true },
      }),
    ]);

    if (reports.length === 0 && demandRows.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    // Channel performance summary
    const channelMap = new Map<string, { budget: number; sales: number; leads: number; closed: number; count: number }>();
    let totalSales = 0;
    let totalBudget = 0;
    let totalLeads = 0;
    let totalClosed = 0;

    for (const r of reports) {
      const ch = r.marketingChannel || "Unknown";
      const existing = channelMap.get(ch) ?? { budget: 0, sales: 0, leads: 0, closed: 0, count: 0 };
      channelMap.set(ch, {
        budget: existing.budget + (r.marketingBudget ?? 0),
        sales: existing.sales + (r.totalSalesAmount ?? 0),
        leads: existing.leads + (r.newLeads ?? 0),
        closed: existing.closed + (r.closedDeals ?? 0),
        count: existing.count + 1,
      });
      totalSales += r.totalSalesAmount ?? 0;
      totalBudget += r.marketingBudget ?? 0;
      totalLeads += r.newLeads ?? 0;
      totalClosed += r.closedDeals ?? 0;
    }
    totalSales += demandRows.reduce(
      (total, record) => total + (record.serviceAmount ?? 0) * (record.serviceQty ?? 1),
      0,
    );

    const buildHeuristic = () => {
      const insights = [];
      const convRate = totalLeads > 0 ? Math.round((totalClosed / totalLeads) * 100) : 0;
      const roi = totalBudget > 0 ? Math.round(((totalSales - totalBudget) / totalBudget) * 100) : 0;
      insights.push({
        title: "လုပ်ဆောင်ချက် အနှစ်ချုပ်",
        insight: `ရောင်းအားပြောင်းလဲမှုနှုန်း (Conversion rate) ${convRate}% နှင့် ရင်းနှီးမြှုပ်နှံမှုအပေါ် အကျိုးအမြတ် (ROI) ${roi}% ရှိပါသည်။ ဝင်ငွေစုစုပေါင်းသည် ${totalSales.toLocaleString()} Ks ဖြစ်ပါသည်။`,
        action: "ဘဏ္ဍာရေးမှတ်တမ်းများ စစ်ဆေးရန်",
        actionType: "view_finance_table"
      });

      const bestChannel = [...channelMap.entries()].sort((a, b) => b[1].sales - a[1].sales)[0];
      if (bestChannel) {
        insights.push({
          title: "အရောင်းအကောင်းဆုံး ချန်နယ်",
          insight: `${bestChannel[0]} ချန်နယ်သည် စုစုပေါင်းရောင်းရငွေ ${bestChannel[1].sales.toLocaleString()} Ks ရရှိပြီး စွမ်းဆောင်ရည်အကောင်းဆုံး ဖြစ်ပါသည်။`,
          action: "အရောင်းမှတ်တမ်းများ ကြည့်ရှုရန်",
          actionType: "view_sales_marketing"
        });
      }

      const worstCPL = [...channelMap.entries()]
        .filter(([, v]) => v.leads > 0)
        .map(([ch, v]) => ({ ch, cpl: v.budget / v.leads }))
        .sort((a, b) => b.cpl - a.cpl)[0];
      if (worstCPL) {
        insights.push({
          title: "ကုန်ကျစရိတ် စိစစ်ရန်",
          insight: `${worstCPL.ch} ချန်နယ်သည် Lead တစ်ခုရရှိရန် ပျမ်းမျှကုန်ကျစရိတ် ${Math.round(worstCPL.cpl).toLocaleString()} Ks ဖြင့် အမြင့်ဆုံး ဖြစ်နေပါသည်။`,
          action: "မာကတ်တင်းချန်နယ်များ စိစစ်ရန်",
          actionType: "view_sales_marketing"
        });
      }
      return insights;
    };

    return NextResponse.json({ recommendations: buildHeuristic(), source: "local" });
  } catch (err) {
    console.error("Business report recommendations failed:", err);
    return NextResponse.json({ recommendations: [] });
  }
}
