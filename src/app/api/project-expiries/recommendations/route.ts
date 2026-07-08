import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { notDeleted } from "@/lib/soft-delete";
import { ownedByUserOrAdmin, uploadedByUserOrAdmin } from "@/lib/tenant-scope";
import { GoogleGenAI } from "@google/genai";
import { differenceInDays } from "date-fns";
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

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await prisma.botSettings.findFirst({
      where: { isActive: true, ...ownedByUserOrAdmin(session) },
      select: { geminiApiKey: true, geminiModel: true },
    });

    const today = new Date();

    // Fetch all projects sorted by most urgent expiry
    const projects = await prisma.projectExpiration.findMany({
      where: { ...uploadedByUserOrAdmin(session), ...notDeleted },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    if (projects.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    // Annotate each project with urgency info
    const annotated = projects.map((p) => {
      const domainDays = p.domainExpireDate
        ? differenceInDays(p.domainExpireDate, today)
        : null;
      const hostingDays = p.hostingExpireDate
        ? differenceInDays(p.hostingExpireDate, today)
        : null;

      const minDays =
        domainDays !== null && hostingDays !== null
          ? Math.min(domainDays, hostingDays)
          : domainDays ?? hostingDays;

      let urgency = "safe";
      if (minDays !== null && minDays < 0) urgency = "expired";
      else if (minDays !== null && minDays <= 15) urgency = "critical";
      else if (minDays !== null && minDays <= 30) urgency = "warning";

      return { ...p, domainDays, hostingDays, minDays, urgency };
    });

    // Prioritise urgent/expired first
    const sorted = [...annotated].sort((a, b) => {
      const order = { expired: 0, critical: 1, warning: 2, safe: 3 };
      return (order[a.urgency as keyof typeof order] ?? 4) -
        (order[b.urgency as keyof typeof order] ?? 4);
    });

    // Heuristic fallback
    const buildHeuristicRecommendations = () =>
      sorted.slice(0, 5).map((p) => {
        let insight = "";
        if (p.urgency === "expired") {
          insight = `Domain သို့မဟုတ် hosting သက်တမ်းကုန်ဆုံးသွားပါပြီ — Website ရပ်တန့်မသွားစေရန် ချက်ချင်းသက်တမ်းတိုးပါ။`;
        } else if (p.urgency === "critical") {
          if (p.minDays === 0) {
            insight = `ယနေ့ သက်တမ်းကုန်ဆုံးပါမည်။ သက်တမ်းတိုးရန် ${p.domainProvider || p.hostingProvider || "provider"} သို့ ချက်ချင်းဆက်သွယ်ပါ။`;
          } else {
            insight = `သက်တမ်းကုန်ဆုံးရန် ${p.minDays} ရက်သာ လိုပါတော့သည်။ သက်တမ်းတိုးရန် ${p.domainProvider || p.hostingProvider || "provider"} သို့ ချက်ချင်းဆက်သွယ်ပါ။`;
          }
        } else if (p.urgency === "warning") {
          insight = `သက်တမ်းကုန်ဆုံးရန် ${p.minDays} ရက် လိုပါသေးသည်။ Website ပြတ်တောက်မှုမရှိစေရန် သက်တမ်းတိုးရန် စီစဉ်ပါ။`;
        } else {
          insight = `ချက်ချင်းဆောင်ရွက်ရန် မလိုသေးပါ (${p.minDays !== null ? `${p.minDays} ရက် ကျန်ရှိနေသေးသည်` : "သက်တမ်းကုန်ရက် မသတ်မှတ်ရသေးပါ"})။`;
        }
        return { projectName: p.projectName, insight };
      });

    if (!settings?.geminiApiKey) {
      return NextResponse.json({ recommendations: buildHeuristicRecommendations() });
    }

    const dataSummary = sorted
      .slice(0, 15)
      .map((p, i) => {
        const dLine = p.domainExpireDate
          ? `Domain expires: ${p.domainExpireDate.toISOString().slice(0, 10)} (${p.domainDays} days)`
          : "Domain: no expiry set";
        const hLine = p.hostingExpireDate
          ? `Hosting expires: ${p.hostingExpireDate.toISOString().slice(0, 10)} (${p.hostingDays} days)`
          : "Hosting: no expiry set";
        return `${i + 1}. Project: "${p.projectName}" | URL: ${p.url || "N/A"} | Package: ${p.packageName || "N/A"} | ${dLine} | ${hLine} | Domain provider: ${p.domainProvider || "N/A"} | Hosting provider: ${p.hostingProvider || "N/A"}`;
      })
      .join("\n");

    const prompt = `You are a smart website infrastructure advisor. Below is a list of client websites with their domain and hosting expiry dates.
Compile a prioritised action list — most urgent first (expired or expiring very soon).
For each project output a single, brief, 1-sentence actionable recommendation.
CRITICAL: The "insight" field must be written in Burmese (Myanmar language) so it is easy for local staff to read.
Output ONLY a JSON array of objects with fields "projectName" and "insight". No markdown, no extra text.

Projects:
"""
${dataSummary}
"""

Example output:
[
  {
    "projectName": "ClientSite.com",
    "insight": "Domain သက်တမ်းမှာ ၃ ရက်ခန့်ကျော်လွန်သွားပါပြီ — Website ပြန်လည်ပွင့်လာစေရန် Namecheap မှတစ်ဆင့် ချက်ချင်းသက်တမ်းတိုးပါ။"
  }
]`;

    const genAI = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const modelName = settings.geminiModel || "gemini-3.1-flash-lite-preview";

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: prompt,
    });

    const responseText = response?.text;
    if (!responseText) {
      return NextResponse.json({ recommendations: buildHeuristicRecommendations() });
    }

    const cleanedJson = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const recommendations = JSON.parse(cleanedJson);
    if (!Array.isArray(recommendations)) throw new Error("Not an array");

    return NextResponse.json({ recommendations });
  } catch (err) {
    console.error("Project expiry recommendations failed:", err);
    // Graceful fallback
    try {
      const projects = await prisma.projectExpiration.findMany({
        where: { ...uploadedByUserOrAdmin(session), ...notDeleted },
        orderBy: { createdAt: "desc" },
        take: 5,
      });
      const today = new Date();
      const fallback = projects.map((p) => {
        const days = p.domainExpireDate ? differenceInDays(p.domainExpireDate, today) : null;
        const insight =
          days !== null && days < 0
            ? `သက်တမ်းကုန်ဆုံးသွားပါပြီ — ချက်ချင်းသက်တမ်းတိုးပါ။`
            : days === 0
            ? `ယနေ့ သက်တမ်းကုန်ဆုံးပါမည် — သက်တမ်းတိုးရန် ချက်ချင်းဆောင်ရွက်ပါ။`
            : days !== null && days <= 30
            ? `သက်တမ်းကုန်ဆုံးရန် ${days} ရက်သာ လိုပါတော့သည် — သက်တမ်းတိုးရန် ပြင်ဆင်ပါ။`
            : `ပရောဂျက်အတွက် သက်တမ်းကုန်ဆုံးမည့် ရက်စွဲများကို စစ်ဆေးပါ။`;
        return { projectName: p.projectName, insight };
      });
      return NextResponse.json({ recommendations: fallback });
    } catch {
      return NextResponse.json({ recommendations: [] });
    }
  }
}
