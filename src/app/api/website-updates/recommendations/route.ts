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
      where: { isActive: true },
      select: { geminiApiKey: true, geminiModel: true },
    });

    // Focus on sites that need attention (not up-to-date)
    const websites = await prisma.websiteUpdate.findMany({
      where: {
        status: { in: ["pending_update", "in_progress"] },
      },
      orderBy: { updatedAt: "asc" }, // Oldest update first = most neglected
      take: 15,
    });

    if (websites.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    // Heuristic fallback
    const buildHeuristicRecommendations = () =>
      websites.slice(0, 5).map((w) => {
        let insight = "";
        if (w.status === "pending_update") {
          insight = `${w.packageName ? `${w.packageName} package` : "Website"} Update လုပ်ရန် ကျန်ရှိနေပါသည် — developer ခန့်အပ်ပြီး အပ်ဒိတ်လုပ်ငန်းစဉ်ကို စတင်ပါ။`;
        } else {
          insight = `အပ်ဒိတ်လုပ်ငန်းစဉ် လုပ်ဆောင်နေဆဲဖြစ်သည် — ပြီးစီးမည့်အချိန်ဇယားကို အတည်ပြုရန် developer နှင့် ဆက်သွယ်ပါ။`;
        }
        return { websiteName: w.name, insight };
      });

    if (!settings?.geminiApiKey) {
      return NextResponse.json({ recommendations: buildHeuristicRecommendations() });
    }

    const dataSummary = websites
      .map((w, i) => {
        const daysSinceUpdate = Math.floor(
          (Date.now() - new Date(w.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
        );
        return `${i + 1}. Website: "${w.name}" | URL: ${w.url || "N/A"} | Business: ${w.businessType || "N/A"} | Package: ${w.packageName || "N/A"} | Status: ${w.status} | Remark: ${w.remark || "N/A"} | Last updated: ${daysSinceUpdate} days ago`;
      })
      .join("\n");

    const prompt = `You are a smart website maintenance advisor. Below is a list of client websites that have pending or in-progress updates.
Compile prioritised action recommendations — most neglected/urgent first.
For each website output a single, brief, 1-sentence actionable recommendation for the team.
CRITICAL: The "insight" field must be written in Burmese (Myanmar language) so it is easy for local staff to read.
Output ONLY a JSON array of objects with fields "websiteName" and "insight". No markdown, no extra text.

Websites needing attention:
"""
${dataSummary}
"""

Example output:
[
  {
    "websiteName": "Restaurant ABC",
    "insight": "အပ်ဒိတ်လုပ်ရန် ကျန်ရှိနေသည်မှာ ၁၄ ရက်ရှိပြီဖြစ်သည် — developer သို့ တာဝန်ပေးအပ်ပြီး ပြီးစီးရမည့်ရက် အတိအကျ သတ်မှတ်ပါ။"
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
    console.error("Website update recommendations failed:", err);
    try {
      const websites = await prisma.websiteUpdate.findMany({
        where: { status: { in: ["pending_update", "in_progress"] } },
        take: 5,
      });
      const fallback = websites.map((w) => ({
        websiteName: w.name,
        insight:
          w.status === "pending_update"
            ? "အပ်ဒိတ်လုပ်ရန် ကျန်ရှိနေပါသည် — အပ်ဒိတ်လုပ်ငန်းစဉ်ကို စတင်ပါ။"
            : "အပ်ဒိတ်လုပ်ငန်းစဉ် လုပ်ဆောင်နေဆဲဖြစ်သည် — developer နှင့် ဆက်သွယ်ပါ။",
      }));
      return NextResponse.json({ recommendations: fallback });
    } catch {
      return NextResponse.json({ recommendations: [] });
    }
  }
}
