import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";
import { NextRequest, NextResponse } from "next/server";

// Helper for Gemini retry
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
      const errStr = typeof err === 'object' && err !== null ? JSON.stringify(err) : String(err);
      if (
        errStr.includes('503') ||
        errStr.includes('429') ||
        errStr.toLowerCase().includes('unavailable') ||
        errStr.toLowerCase().includes('high demand') ||
        errStr.toLowerCase().includes('overloaded') ||
        errStr.toLowerCase().includes('fetch failed')
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

    // Fetch up to 15 pending records that need follow-up
    const pendingRecords = await prisma.demandRecord.findMany({
      where: {
        status: { notIn: ['closed', 'completed'] },
        customerName: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    if (pendingRecords.length === 0) {
      return NextResponse.json({ recommendations: [] });
    }

    // Heuristic Fallback in case no Gemini key is active or it fails
    const buildHeuristicRecommendations = () => {
      return pendingRecords.slice(0, 5).map(r => {
        const serviceText = r.serviceName ? `Interested in ${r.serviceName}` : 'Inquired about services';
        const dateText = r.followUpDate 
          ? `due for follow-up on ${r.followUpDate.toISOString().slice(0, 10)}` 
          : 'no follow-up date scheduled';
        return {
          customerName: r.customerName || 'Unknown Customer',
          insight: `${serviceText}. Action: Follow up to discuss packages (${dateText}).`,
        };
      });
    };

    if (!settings?.geminiApiKey) {
      return NextResponse.json({ recommendations: buildHeuristicRecommendations() });
    }

    // Format records for prompt
    const dataSummary = pendingRecords.map((r, i) => {
      return `${i + 1}. Customer: "${r.customerName}" | Service: "${r.serviceName || 'N/A'}" | Date: ${r.createdAt.toISOString().slice(0, 10)} | Notes: "${r.note || 'N/A'}" | FU Date: ${r.followUpDate ? r.followUpDate.toISOString().slice(0, 10) : 'N/A'}`;
    }).join('\n');

    const prompt = `You are a smart sales pipeline analyzer. Below is a list of recent pending customer inquiries/demands. Compile a "Smart Hotlist" of actionable follow-up priorities.
Group by customer name. Highlight what they want and recommend a single, brief, 1-sentence action. 
Output exactly a JSON array of objects with fields "customerName" and "insight". Do not output markdown, explainers, or any text other than the JSON block.

Pending Inquiries:
"""
${dataSummary}
"""

Example Output:
[
  {
    "customerName": "Thura",
    "insight": "Interested in Telegram Sale Bot. Action: Send pricing brochure and schedule demo."
  }
]`;

    const genAI = new GoogleGenAI({ apiKey: settings.geminiApiKey });
    const modelName = settings.geminiModel || 'gemini-3.1-flash-lite-preview';

    const response = await generateContentWithRetry(genAI, {
      model: modelName,
      contents: prompt,
    });

    const responseText = response?.text;
    if (!responseText) {
      return NextResponse.json({ recommendations: buildHeuristicRecommendations() });
    }

    const cleanedJson = responseText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    const recommendations = JSON.parse(cleanedJson);
    if (!Array.isArray(recommendations)) {
      throw new Error("Result is not an array");
    }

    return NextResponse.json({ recommendations });
  } catch (err) {
    console.error("Failed to generate AI recommendations:", err);
    // In case of any error, we return the heuristic fallback so the dashboard card never crashes
    try {
      const pendingRecords = await prisma.demandRecord.findMany({
        where: {
          status: { notIn: ['closed', 'completed'] },
          customerName: { not: null },
        },
        orderBy: { createdAt: 'desc' },
        take: 5,
      });
      const fallbackRecs = pendingRecords.map(r => {
        const serviceText = r.serviceName ? `Interested in ${r.serviceName}` : 'Inquired about services';
        const dateText = r.followUpDate 
          ? `due on ${r.followUpDate.toISOString().slice(0, 10)}` 
          : 'no date';
        return {
          customerName: r.customerName || 'Unknown Customer',
          insight: `${serviceText}. Action: Follow up to check requirements (${dateText}).`,
        };
      });
      return NextResponse.json({ recommendations: fallbackRecs });
    } catch {
      return NextResponse.json({ recommendations: [] });
    }
  }
}
