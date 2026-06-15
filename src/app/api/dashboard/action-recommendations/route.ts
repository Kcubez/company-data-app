import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
        errStr.includes("503") ||
        errStr.includes("429") ||
        errStr.toLowerCase().includes("unavailable") ||
        errStr.toLowerCase().includes("high demand") ||
        errStr.toLowerCase().includes("overloaded") ||
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

export type ActionRecommendation = {
  area: "marketing" | "sales" | "appointments" | "general";
  severity: "urgent" | "warning" | "info";
  title: string;
  insight: string;
  action: string;
};

// Heuristic fallback — always runs when Gemini is unavailable (Burmese output)
function buildHeuristicRecommendations(data: {
  highPriority: number;
  missingPhone: number;
  overdue: number;
  dueToday: number;
  closedDeals: number;
  pendingDeals: number;
  newLeads: number;
  appointmentsMade: number;
  appointmentsKept: number;
  callsMade: number;
  totalSalesAmount: number;
  targetSalesAmount: number | null;
  elapsedRatio: number;
}): ActionRecommendation[] {
  const recs: ActionRecommendation[] = [];

  // Revenue pacing check
  if (data.targetSalesAmount && data.elapsedRatio > 0.3) {
    const expectedRevenue = data.targetSalesAmount * data.elapsedRatio;
    const gap = expectedRevenue - data.totalSalesAmount;
    if (gap > 0) {
      const pct = Math.round((data.totalSalesAmount / expectedRevenue) * 100);
      recs.push({
        area: "sales",
        severity: pct < 60 ? "urgent" : "warning",
        title: "အရောင်းဝင်ငွေ နှောင့်နှေးနေသည်",
        insight: `ဝင်ငွေသည် မျှော်မှန်းထားသောနှုန်း၏ ${pct}% သာရှိသေးသည်။ ${Math.round(gap).toLocaleString()} Ks ကွာဟချက် ပြည့်မီရန် လိုနေသည်။`,
        action: "ဤကာလအတွင်း High-Potential Lead တွေနဲ့ Pending Deal တွေကို Sales Team ကို အာရုံစိုက်ပြီး ပိတ်ရန် အလျင်အမြန်ဆောင်ရွက်ပါ။",
      });
    }
  }

  // High-priority leads not being followed up
  if (data.highPriority > 5) {
    recs.push({
      area: "sales",
      severity: "urgent",
      title: `High-Potential Lead ${data.highPriority} ခု အာရုံစိုက်ရန် လိုသည်`,
      insight: `ဦးစားပေးရမည့် Open Lead ${data.highPriority} ခု ရှိနေသည်။ နောက်ကျလေ Close Rate ကျလေ ဖြစ်သည်။`,
      action: "ယနေ့ပင် High-Priority Lead တွေကို Sales Rep တွေ တာဝန်ပေးပြီး Demand Sheet မှာ ရလဒ်မှတ်ပါ။",
    });
  }

  // Missing phone numbers → marketing quality
  if (data.missingPhone > 3) {
    recs.push({
      area: "marketing",
      severity: "warning",
      title: "Lead ဖမ်းဆည်းမှု အရည်အသွေး တိုးတက်ရန် လိုသည်",
      insight: `ဖုန်းနံပါတ် မပါသော Open Lead ${data.missingPhone} ခု ရှိသဖြင့် ဆက်သွယ်မရနိုင်ပါ။`,
      action: "Marketing Team ကို Lead ကို Sales သို့ မပို့မီ ဖုန်းနံပါတ် ရယူရန် တာဝန်ပေးပါ။",
    });
  }

  // Overdue follow-ups
  if (data.overdue > 0) {
    recs.push({
      area: "sales",
      severity: "urgent",
      title: `Follow-up ${data.overdue} ခု သက်တမ်းကျော်နေပြီ`,
      insight: "သက်တမ်းကျော် Follow-up ရှိနေခြင်းသည် Lead လက်ဆင့်ကမ်းမှုတွင် ချို့ယွင်းနေကြောင်း ညွှန်ပြသည်။",
      action: "သက်တမ်းကျော်နေသော List ကို အရင်ဆုံး ဆောင်ရွက်ပြီး ဖုန်းဆက်ပြီးတိုင်း Status အပ်ဒိတ်ပါ။",
    });
  } else if (data.dueToday > 0) {
    recs.push({
      area: "sales",
      severity: "warning",
      title: `ယနေ့ Follow-up လုပ်ရမည့်အရာ ${data.dueToday} ခု ရှိသည်`,
      insight: "ယနေ့ Follow-up တွေ Dashboard မှာ ရှိနေသည်။ ညနေမရောက်မီ ဆောင်ရွက်ပါ။",
      action: "ယနေ့ Follow-up ဖုန်းဆက်မှုများ ပြီးဆုံးပြီး ရလဒ်ကို Record တစ်ခုချင်းမှာ မှတ်တမ်းတင်ပါ။",
    });
  }

  // Low appointment show rate
  if (data.appointmentsMade > 0 && data.appointmentsKept < data.appointmentsMade * 0.5) {
    const showRate = Math.round((data.appointmentsKept / data.appointmentsMade) * 100);
    recs.push({
      area: "appointments",
      severity: showRate < 30 ? "urgent" : "warning",
      title: "Appointment လာရောက်နှုန်း နည်းနေသည်",
      insight: `Appointment ${data.appointmentsMade} ခုထဲမှ ${data.appointmentsKept} ခုသာ လာရောက်သည် (${showRate}%)။ Lead အရည်အသွေး ညံ့နေနိုင်သည်။`,
      action: "Lead Source ကို ပြန်စစ်ပြီး Appointment မချိန်းမီ Lead Qualify ကို ပိုတင်းကျပ်စွာ လုပ်ပါ။",
    });
  }

  // Low new leads from marketing
  if (data.callsMade > 0 && data.newLeads < data.callsMade * 0.1) {
    recs.push({
      area: "marketing",
      severity: "info",
      title: "Lead ထုတ်လုပ်နှုန်း နည်းနေသည်",
      insight: `ဖုန်းဆက် ${data.callsMade} ကြိမ်မှ New Lead ${data.newLeads} ခုသာ ရသည်။ Targeting ပြန်ပြင်ရန် လိုနိုင်သည်။`,
      action: "Outreach Lead အရည်အသွေး တိုးတက်ရန် Channel ကိုပြောင်း သို့မဟုတ် Message Angle အသစ် စမ်းကြည့်ပါ။",
    });
  }

  // Healthy fallback
  if (recs.length === 0) {
    recs.push({
      area: "general",
      severity: "info",
      title: "လုပ်ငန်းလည်ပတ်မှု ကောင်းနေသည်",
      insight: "လက်ရှိ Data များအရ အရေးပေါ် Bottleneck မတွေ့ရပါ။",
      action: "Demand Data ဆက်တင်သွင်းပြီး Follow-up တိုင်းတွင် ရက်ချိန်း သတ်မှတ်ထားရန် သေချာပါ။",
    });
  }

  return recs;
}

// GET /api/dashboard/action-recommendations
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const { searchParams } = req.nextUrl;
  const period = searchParams.get("period") === "year" ? "year" : "month";
  const monthParam = Number(searchParams.get("month") || now.getMonth() + 1);
  const yearParam = Number(searchParams.get("year") || now.getFullYear());
  const month = Math.min(12, Math.max(1, Number.isFinite(monthParam) ? monthParam : now.getMonth() + 1));
  const year = Number.isFinite(yearParam) ? yearParam : now.getFullYear();
  const periodStart = period === "year" ? new Date(year, 0, 1) : new Date(year, month - 1, 1);
  const periodEnd = period === "year" ? new Date(year + 1, 0, 1) : new Date(year, month, 1);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  try {
    const [
      settings,
      highPriorityCount,
      missingPhoneCount,
      overdueCount,
      dueTodayCount,
      businessAgg,
      demandAgg,
      latestTargets,
    ] = await Promise.all([
      prisma.botSettings.findFirst({ where: { isActive: true }, select: { geminiApiKey: true, geminiModel: true } }),
      // Scoped to the selected period so May data doesn't bleed into June view
      prisma.demandRecord.count({
        where: {
          priority: "high",
          status: { notIn: ["closed", "completed"] },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      prisma.demandRecord.count({
        where: {
          missingFields: { has: "phone" },
          status: { notIn: ["closed", "completed"] },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      prisma.demandRecord.count({
        where: {
          followUpStatus: "overdue",
          status: { notIn: ["closed", "completed"] },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      prisma.demandRecord.count({
        where: {
          followUpDate: { gte: startOfToday, lt: new Date(startOfToday.getTime() + 86400000) },
          status: { notIn: ["closed", "completed"] },
          createdAt: { gte: periodStart, lt: periodEnd },
        },
      }),
      prisma.businessReport.aggregate({
        _sum: {
          totalSalesAmount: true,
          callsMade: true,
          appointmentsMade: true,
          appointmentsKept: true,
          newLeads: true,
          closedDeals: true,
          pendingDeals: true,
        },
        where: { reportDate: { gte: periodStart, lt: periodEnd } },
      }),
      prisma.demandRecord.aggregate({
        _sum: { serviceAmount: true },
        where: { createdAt: { gte: periodStart, lt: periodEnd } },
      }),
      prisma.businessReport.findFirst({
        where: {
          reportDate: { gte: periodStart, lt: periodEnd },
          OR: [{ targetSalesAmount: { not: null } }],
        },
        orderBy: { reportDate: "desc" },
        select: { targetSalesAmount: true },
      }),
    ]);

    const msPerDay = 24 * 60 * 60 * 1000;
    const totalDaysInPeriod = Math.round((periodEnd.getTime() - periodStart.getTime()) / msPerDay);
    let elapsedDays = totalDaysInPeriod;
    if (now >= periodStart && now < periodEnd) {
      elapsedDays = Math.floor((startOfToday.getTime() - periodStart.getTime()) / msPerDay) + 1;
    } else if (periodStart > now) {
      elapsedDays = 0;
    }
    const elapsedRatio = totalDaysInPeriod > 0 ? elapsedDays / totalDaysInPeriod : 0;
    const periodLabel = period === "year" ? `${year}` : `${month}/${year}`;
    const targetLabel = period === "year" ? "ကာလပစ်မှတ်" : "လစဉ် အရောင်းပစ်မှတ်";

    const totalSalesAmount = Math.max(
      businessAgg._sum.totalSalesAmount ?? 0,
      demandAgg._sum.serviceAmount ?? 0
    );

    const inputData = {
      highPriority: highPriorityCount,
      missingPhone: missingPhoneCount,
      overdue: overdueCount,
      dueToday: dueTodayCount,
      closedDeals: businessAgg._sum.closedDeals ?? 0,
      pendingDeals: businessAgg._sum.pendingDeals ?? 0,
      newLeads: businessAgg._sum.newLeads ?? 0,
      appointmentsMade: businessAgg._sum.appointmentsMade ?? 0,
      appointmentsKept: businessAgg._sum.appointmentsKept ?? 0,
      callsMade: businessAgg._sum.callsMade ?? 0,
      totalSalesAmount,
      targetSalesAmount: latestTargets?.targetSalesAmount ?? null,
      elapsedRatio,
    };

    if (!settings?.geminiApiKey) {
      return NextResponse.json({ recommendations: buildHeuristicRecommendations(inputData) });
    }

    // Build Gemini prompt
    const prompt = `သင်သည် မြန်မာနိုင်ငံ လုပ်ငန်းတစ်ခုအတွက် အတွေ့အကြုံရင့် Sales Operations Analyst တစ်ဦးဖြစ်သည်။ အောက်ဖော်ပြပါ real-time လုပ်ငန်းမက်ထရစ်တွေကို ခွဲခြမ်းစိတ်ဖြာပြီး ဆောင်ရွက်ရမည့်အကြံဉာဏ် ၂-၄ ခု ပေးပါ။

လက်ရှိကာလ မက်ထရစ်များ (${period === "year" ? "နှစ်" : "လ"}: ${periodLabel}၊ ${elapsedDays}/${totalDaysInPeriod} ရက် ကုန်ဆုံးပြီ):
- ဦးစားပေး Open Lead အရေအတွက်: ${inputData.highPriority}
- ဖုန်းနံပါတ် မပါသော Open Lead: ${inputData.missingPhone}
- သက်တမ်းကျော် Follow-up: ${inputData.overdue}
- ယနေ့ Follow-up လုပ်ရမည့်အရေအတွက်: ${inputData.dueToday}
- ဤကာလ ရောင်းရငွေ: ${inputData.totalSalesAmount.toLocaleString()} Ks
- ${targetLabel}: ${inputData.targetSalesAmount ? inputData.targetSalesAmount.toLocaleString() + ' Ks' : 'မသတ်မှတ်ရသေးပါ'}
- ဖုန်းဆက်မှုအရေအတွက်: ${inputData.callsMade}
- Appointment ချိန်းဆိုမှု: ${inputData.appointmentsMade}
- Appointment တကယ်လာရောက်မှု: ${inputData.appointmentsKept}
- New Lead အရေအတွက်: ${inputData.newLeads}
- ပိတ်ဆင်းနိုင်သော Deal: ${inputData.closedDeals}
- ဆိုင်းငံ့နေသော Deal: ${inputData.pendingDeals}

Bottleneck သည် ဘယ်နေရာမှာရှိသည်ကို ဖော်ထုတ်ပါ — Marketing (Lead ထုတ်လုပ်မှု/အရည်အသွေး)၊ Sales (Follow-up/Close Rate)၊ Appointments (လာရောက်နှုန်း/အရည်အသွေး) — ထဲမှ ဖော်ထုတ်ပြီး ဆောင်ရွက်ရမည့်အကြံဉာဏ်ပေးပါ။

အရေးကြီး — "title"၊ "insight"၊ "action" ၃ ခုလုံးကို မြန်မာဘာသာ (Burmese) ဖြင့်သာ ရေးပါ။ ပြင်ပဆောင်ရွက်ချက် ရှိသမျှကိုလည်း မြန်မာဘာသာနဲ့ ဖော်ပြပါ။

JSON Array (markdown မပါ၊ ရှင်းလင်းချက် မပါ) ကိုသာ ထုတ်ပေးပါ:
[
  {
    "area": "marketing" | "sales" | "appointments" | "general",
    "severity": "urgent" | "warning" | "info",
    "title": "မြန်မာဘာသာဖြင့် အကြောင်းအရာ အတိုချုပ် (စကားလုံး ၈ ခုအောက်)",
    "insight": "ဘာဖြစ်နေသည်နှင့် ဘာကြောင့် အရေးကြီးသည် ကို မြန်မာဘာသာဖြင့် ၁-၂ ကြောင်း ရှင်းပြပါ",
    "action": "Team အတွက် ဆောင်ရွက်ရမည့်အကြံဉာဏ်ကို မြန်မာဘာသာဖြင့် ၁ ကြောင်း ဖော်ပြပါ"
  }
]`;

    const genAI = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const modelName = settings.geminiModel || "gemini-3.1-flash-lite-preview";

    const response = await generateContentWithRetry(genAI, { model: modelName, contents: prompt });
    const responseText = response?.text;

    if (!responseText) {
      return NextResponse.json({ recommendations: buildHeuristicRecommendations(inputData) });
    }

    const cleaned = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) throw new Error("Not an array");

    return NextResponse.json({ recommendations: parsed as ActionRecommendation[] });
  } catch (err) {
    console.error("Action recommendations error:", err);
    return NextResponse.json({ recommendations: [] });
  }
}
