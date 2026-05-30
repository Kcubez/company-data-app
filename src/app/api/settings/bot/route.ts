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

// PUT /api/settings/bot — update bot settings
export async function PUT(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { botToken } = body;

  try {
    const settings = await prisma.botSettings.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        botToken: botToken || null,
        isActive: !!botToken,
      },
      update: {
        botToken: botToken || null,
        isActive: !!botToken,
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
    });
  } catch (error) {
    console.error("Failed to save bot settings:", error);
    return NextResponse.json(
      { message: "Failed to save settings" },
      { status: 500 }
    );
  }
}
