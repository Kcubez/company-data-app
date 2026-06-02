import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

function serializeDemandRecord(record: Record<string, unknown>) {
  const result = { ...record };
  if (result.followUpDate instanceof Date) result.followUpDate = result.followUpDate.toISOString();
  if (result.createdAt instanceof Date) result.createdAt = result.createdAt.toISOString();
  if (result.updatedAt instanceof Date) result.updatedAt = result.updatedAt.toISOString();
  if (result.message && typeof result.message === "object") {
    const message = { ...(result.message as Record<string, unknown>) };
    if (typeof message.chatId === "bigint") message.chatId = message.chatId.toString();
    if (message.receivedAt instanceof Date) message.receivedAt = message.receivedAt.toISOString();
    result.message = message;
  }
  if (result.sender && typeof result.sender === "object") {
    const sender = { ...(result.sender as Record<string, unknown>) };
    if (typeof sender.telegramUserId === "bigint") {
      sender.telegramUserId = sender.telegramUserId.toString();
    }
    result.sender = sender;
  }
  return result;
}

export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20")));
  const search = searchParams.get("search") || "";
  const status = searchParams.get("status") || "";
  const category = searchParams.get("category") || "";
  const reportType = searchParams.get("reportType") || "";
  const senderId = searchParams.get("senderId") || "";

  const where: Record<string, unknown> = {};

  if (status) where.status = status;
  if (category) where.category = category;
  if (reportType) where.reportType = reportType;
  if (senderId) where.senderId = senderId;

  if (search) {
    where.OR = [
      { customerName: { contains: search, mode: "insensitive" } },
      { note: { contains: search, mode: "insensitive" } },
      { sender: { displayName: { contains: search, mode: "insensitive" } } },
      { sender: { username: { contains: search, mode: "insensitive" } } },
    ];
  }

  const [records, total] = await Promise.all([
    prisma.demandRecord.findMany({
      where,
      include: {
        sender: true,
        message: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.demandRecord.count({ where }),
  ]);

  return NextResponse.json({
    records: records.map((record) => serializeDemandRecord(record)),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
}
