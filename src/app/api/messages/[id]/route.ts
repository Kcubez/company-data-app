import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// DELETE /api/messages/:id — delete a message and all its linked data
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
    // Find the message with its linked counts so we can report what was deleted
    const message = await prisma.telegramMessage.findUnique({
      where: { id },
      select: {
        senderId: true,
        _count: {
          select: {
            demandRecords: true,
            pendingDemandImports: true,
            businessReports: true,
          },
        },
      },
    });

    if (!message) {
      return NextResponse.json({ message: "Message not found" }, { status: 404 });
    }

    // Delete QA documents that originated from this message's file
    // (QA docs link by fileName — match on sourceFileName from demand records)
    const linkedDemandRecords = await prisma.demandRecord.findMany({
      where: { messageId: id },
      select: { sourceFileName: true },
    });
    const fileNames = [...new Set(
      linkedDemandRecords
        .map(r => r.sourceFileName)
        .filter(Boolean) as string[]
    )];
    if (fileNames.length > 0) {
      await prisma.qADocument.deleteMany({
        where: { fileName: { in: fileNames } },
      });
    }

    // Delete the message — DemandRecord and PendingDemandImport cascade automatically
    await prisma.telegramMessage.delete({ where: { id } });

    // Decrement the sender's messageCount
    await prisma.telegramSender.update({
      where: { id: message.senderId },
      data: { messageCount: { decrement: 1 } },
    });

    return NextResponse.json({
      success: true,
      deleted: {
        demandRecords: message._count.demandRecords,
        pendingImports: message._count.pendingDemandImports,
        businessReports: message._count.businessReports,
        qaDocuments: fileNames.length,
      },
    });
  } catch (error) {
    console.error("Delete message error:", error);
    return NextResponse.json({ message: "Failed to delete message" }, { status: 500 });
  }
}
