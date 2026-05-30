import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {

  try {
    const body = await req.json();
    const message = body.message;

    // Only process text messages
    if (!message || !message.text) {
      return NextResponse.json({ ok: true });
    }

    const from = message.from;
    if (!from) {
      return NextResponse.json({ ok: true });
    }

    const displayName = [from.first_name, from.last_name]
      .filter(Boolean)
      .join(" ");

    // Upsert sender — create if new, update info if existing
    const sender = await prisma.telegramSender.upsert({
      where: { telegramUserId: BigInt(from.id) },
      create: {
        telegramUserId: BigInt(from.id),
        firstName: from.first_name || "Unknown",
        lastName: from.last_name || null,
        username: from.username || null,
        displayName: displayName || "Unknown",
        messageCount: 1,
        lastMessageAt: new Date(),
      },
      update: {
        firstName: from.first_name || undefined,
        lastName: from.last_name || null,
        username: from.username || null,
        displayName: displayName || undefined,
        messageCount: { increment: 1 },
        lastMessageAt: new Date(),
      },
    });

    // Create message record
    await prisma.telegramMessage.create({
      data: {
        telegramMsgId: message.message_id,
        text: message.text,
        senderId: sender.id,
        chatId: BigInt(message.chat.id),
        chatTitle: message.chat.title || null,
        receivedAt: new Date(message.date * 1000),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Telegram webhook error:", error);
    // Always return 200 to Telegram to prevent retries
    return NextResponse.json({ ok: true });
  }
}
