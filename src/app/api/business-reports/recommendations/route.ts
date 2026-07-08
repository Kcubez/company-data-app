import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { ownedByUserOrAdmin, uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

async function generateContentWithRetry(
  genAI: GoogleGenAI,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options: { model: string; contents: string | any[] },
  maxRetries = 3,
  delayMs = 1500
): Promise<{ text?: string }> {
  let lastError: unknown = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await (genAI.models.generateContent(options) as Promise<{ text?: string }>);
      return response;
    } catch (err) {
      lastError = err;
      const errStr = typeof err === "object" && err !== null ? JSON.stringify(err) : String(err);
      if (
        errStr.includes("503") || errStr.includes("429") ||
        errStr.toLowerCase().includes("unavailable") ||
        errStr.toLowerCase().includes("fetch failed")
      ) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * Math.pow(2, i)));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// GET /api/business-reports/recommendations
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });

  try {
    const settings = await prisma.botSettings.findFirst({
      where: { isActive: true, ...ownedByUserOrAdmin(session) },
      select: { geminiApiKey: true, geminiModel: true },
    });

    // Aggregate last 30 reports for trend analysis
    const reports = await prisma.businessReport.findMany({
      where: { ...uploadedByUserOrAdmin(session), ...notDeleted },
      orderBy: { reportDate: "desc" },
      take: 30,
      include: { sender: { select: { displayName: true } } },
    });

    if (reports.length === 0) {
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

    if (!settings?.geminiApiKey) {
      return NextResponse.json({ recommendations: buildHeuristic() });
    }

    const channelSummary = [...channelMap.entries()]
      .map(([ch, v]) => `Channel: ${ch} | Budget: ${v.budget.toLocaleString()} Ks | Sales: ${v.sales.toLocaleString()} Ks | Leads: ${v.leads} | Closed: ${v.closed} | Reports: ${v.count}`)
      .join("\n");

    const recentSummary = reports.slice(0, 10).map((r, i) =>
      `${i + 1}. Date: ${r.reportDate.toISOString().slice(0, 10)} | Channel: ${r.marketingChannel || "—"} | Budget: ${r.marketingBudget ?? 0} Ks | Calls: ${r.callsMade ?? "—"} | Appts Made: ${r.appointmentsMade ?? "—"} | Appts Kept: ${r.appointmentsKept ?? "—"} | Leads: ${r.newLeads ?? "—"} | Sales: ${r.totalSalesAmount ?? 0} Ks | Closed: ${r.closedDeals ?? "—"} | Pending: ${r.pendingDeals ?? "—"}`
    ).join("\n");

    const prompt = `You are a business performance analyst. Analyze the following marketing and sales data and give 4-5 concise, actionable insights.
CRITICAL: The "title", "insight" and "action" fields must be written in Burmese (Myanmar language) so they are easy for local staff to read.

=== CHANNEL PERFORMANCE SUMMARY ===
${channelSummary}

=== RECENT DAILY REPORTS ===
${recentSummary}

=== OVERALL ===
Total Sales: ${totalSales.toLocaleString()} Ks | Total Budget: ${totalBudget.toLocaleString()} Ks | Total Leads: ${totalLeads} | Total Closed: ${totalClosed}
Conversion Rate: ${totalLeads > 0 ? Math.round((totalClosed / totalLeads) * 100) : 0}% | ROI: ${totalBudget > 0 ? Math.round(((totalSales - totalBudget) / totalBudget) * 100) : 0}%

"actionType" must be selected strictly from these English enums:
- "view_sales_marketing": if recommending following up on leads, checking ad/leads channels, improving close rate, or managing quoted/pending deals
- "view_customer_service": if recommending checking customer follow-up actions, overdue, or due follow-ups
- "view_finance_table": if recommending reviewing overall ROI, budgets, expenses, or detailed business report records
- "general_dashboard": for general overall business analysis or health checks

"action" is a short Burmese call-to-action button label (e.g. "အသေးစိတ်ကြည့်ရန်", "Follow-up လုပ်ဆောင်ရန်", "ဘတ်ဂျက်စစ်ဆေးရန်") that matches the recommended action.

Output ONLY a JSON array. Each element:
{ 
  "title": string, 
  "insight": string,
  "action": string,
  "actionType": "view_sales_marketing" | "view_customer_service" | "view_finance_table" | "general_dashboard"
}.
No markdown, no extra text. Max 5 items. Be specific and actionable.`;

    const genAI = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const modelName = settings.geminiModel || "gemini-3.1-flash-lite-preview";
    const response = await generateContentWithRetry(genAI, { model: modelName, contents: prompt });
    const responseText = response?.text;
    if (!responseText) return NextResponse.json({ recommendations: buildHeuristic() });

    const cleaned = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const recommendations = JSON.parse(cleaned);
    if (!Array.isArray(recommendations)) throw new Error("Not an array");

    return NextResponse.json({ recommendations });
  } catch (err) {
    console.error("Business report recommendations failed:", err);
    return NextResponse.json({ recommendations: [] });
  }
}
