import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// DELETE /api/messages/:id — delete a message
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  try {
    // Find the message to get the senderId
    const message = await prisma.telegramMessage.findUnique({
      where: { id },
      select: { senderId: true },
    });

    if (!message) {
      return NextResponse.json({ message: "Message not found" }, { status: 404 });
    }

    // Delete the message
    await prisma.telegramMessage.delete({ where: { id } });

    // Decrement the sender's messageCount
    await prisma.telegramSender.update({
      where: { id: message.senderId },
      data: { messageCount: { decrement: 1 } },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete message error:", error);
    return NextResponse.json({ message: "Failed to delete message" }, { status: 500 });
  }
}
