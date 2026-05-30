import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/settings/bot — get current user's bot settings
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const settings = await prisma.botSettings.findUnique({
    where: { userId: session.user.id },
  });

  if (!settings) {
    return NextResponse.json({
      settings: {
        botToken: "",
        isActive: false,
      },
    });
  }

  // Mask the bot token for security (show only last 8 chars)
  const maskedToken = settings.botToken
    ? "•".repeat(Math.max(0, settings.botToken.length - 8)) +
      settings.botToken.slice(-8)
    : "";

  return NextResponse.json({
    settings: {
      botToken: maskedToken,
      isActive: settings.isActive,
      updatedAt: settings.updatedAt,
    },
  });
}

// PUT /api/settings/bot — update bot settings & register webhook with Telegram
export async function PUT(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { botToken } = body;

  try {
    // Build the webhook URL from the current request origin
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ||
      `${req.nextUrl.protocol}//${req.nextUrl.host}`;
    const webhookUrl = `${origin}/api/telegram/webhook`;

    let webhookRegistered = false;

    // If a bot token is provided, register the webhook with Telegram
    if (botToken && !botToken.includes("•")) {
      // Only register if it's a real token (not the masked one)
      const telegramRes = await fetch(
        `https://api.telegram.org/bot${botToken}/setWebhook`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            url: webhookUrl,
            allowed_updates: ["message"],
          }),
        }
      );

      const telegramData = await telegramRes.json();

      if (!telegramData.ok) {
        return NextResponse.json(
          {
            message: `Telegram error: ${telegramData.description || "Failed to set webhook"}`,
          },
          { status: 400 }
        );
      }

      webhookRegistered = true;
    }

    // Determine the token to save
    // If it contains "•", the user didn't change it — keep the old one
    const tokenToSave =
      botToken && !botToken.includes("•") ? botToken : undefined;

    const settings = await prisma.botSettings.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        botToken: tokenToSave || null,
        isActive: !!tokenToSave,
      },
      update: {
        ...(tokenToSave !== undefined ? { botToken: tokenToSave || null } : {}),
        isActive: tokenToSave !== undefined ? !!tokenToSave : undefined,
      },
    });

    // Mask the token in response
    const maskedToken = settings.botToken
      ? "•".repeat(Math.max(0, settings.botToken.length - 8)) +
        settings.botToken.slice(-8)
      : "";

    return NextResponse.json({
      settings: {
        botToken: maskedToken,
        isActive: settings.isActive,
        updatedAt: settings.updatedAt,
      },
      webhookRegistered,
      webhookUrl: webhookRegistered ? webhookUrl : undefined,
    });
  } catch (error) {
    console.error("Failed to save bot settings:", error);
    return NextResponse.json(
      { message: "Failed to save settings" },
      { status: 500 }
    );
  }
}
