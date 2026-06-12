import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseDemandRowsFromWorkbook } from "@/lib/demand-import";
import { NextRequest, NextResponse } from "next/server";

function normalizeCustomerName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

function serializeRecord(record: Record<string, unknown>) {
  const result = { ...record };
  if (result.followUpDate instanceof Date) result.followUpDate = result.followUpDate.toISOString();
  if (result.createdAt instanceof Date) result.createdAt = result.createdAt.toISOString();
  if (result.updatedAt instanceof Date) result.updatedAt = result.updatedAt.toISOString();
  return result;
}

async function getDashboardSender() {
  return prisma.telegramSender.upsert({
    where: { telegramUserId: BigInt(0) },
    update: {
      displayName: "Dashboard Upload",
      firstName: "Dashboard",
      lastMessageAt: new Date(),
      messageCount: { increment: 1 },
    },
    create: {
      telegramUserId: BigInt(0),
      firstName: "Dashboard",
      displayName: "Dashboard Upload",
      activeReportType: "demand_report",
      messageCount: 1,
      lastMessageAt: new Date(),
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Upload a spreadsheet file" }, { status: 400 });
  }

  const lowerName = file.name.toLowerCase();
  if (!lowerName.endsWith(".xlsx") && !lowerName.endsWith(".xls") && !lowerName.endsWith(".csv")) {
    return NextResponse.json(
      { message: "Dashboard upload currently supports CSV, XLS, and XLSX demand files" },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const { rows, detectedColumns, columnMapping } = parseDemandRowsFromWorkbook(buffer);
  if (rows.length === 0) {
    return NextResponse.json({ message: "No importable demand rows found" }, { status: 400 });
  }

  const sender = await getDashboardSender();
  const telegramMsgId = -Math.floor(Date.now() % 2_000_000_000);
  const message = await prisma.telegramMessage.create({
    data: {
      telegramMsgId,
      text: `Dashboard demand upload: ${file.name}`,
      senderId: sender.id,
      chatId: BigInt(0),
      chatTitle: "Dashboard Upload",
      receivedAt: new Date(),
    },
  });

  const batch = await prisma.demandImportBatch.create({
    data: {
      fileName: file.name,
      fileType: file.type || lowerName.split(".").pop() || null,
      status: "imported",
      source: "dashboard_upload",
      detectedColumns,
      columnMapping,
      rowCount: rows.length,
      importedCount: 0,
      uploadedByUserId: session.user.id,
    },
  });

  const createdRecords = [];

  for (const row of rows) {
    let customerId: string | null = null;
    if (row.normalized.customerName) {
      const nameNormalized = normalizeCustomerName(row.normalized.customerName);
      const existing =
        (await prisma.customer.findFirst({ where: { nameNormalized } })) ||
        (await prisma.customer.findUnique({ where: { name: row.normalized.customerName } }));

      const customer = existing
        ? await prisma.customer.update({
            where: { id: existing.id },
            data: {
              nameNormalized: existing.nameNormalized || nameNormalized,
              ...(row.normalized.customerPhone ? { phone: row.normalized.customerPhone } : {}),
              ...(row.normalized.customerCompany ? { company: row.normalized.customerCompany } : {}),
              updatedAt: new Date(),
            },
          })
        : await prisma.customer.create({
            data: {
              name: row.normalized.customerName,
              nameNormalized,
              phone: row.normalized.customerPhone,
              company: row.normalized.customerCompany,
            },
          });

      customerId = customer.id;
      await prisma.customerActivity.create({
        data: {
          customerId,
          senderId: sender.id,
          action: "dashboard_import",
          description: `${file.name}: ${row.analysis.recommendedAction}`,
        },
      });
    }

    const record = await prisma.demandRecord.create({
      data: {
        messageId: message.id,
        senderId: sender.id,
        customerId,
        customerName: row.normalized.customerName,
        category: row.normalized.category,
        status: row.normalized.status,
        note: row.normalized.note,
        sourceType: "dashboard_upload",
        sourceFileName: file.name,
        rawData: row.rawData,
        normalizedData: {
          customerName: row.normalized.customerName,
          customerPhone: row.normalized.customerPhone,
          customerCompany: row.normalized.customerCompany,
          serviceName: row.normalized.serviceName,
          serviceAmount: row.normalized.serviceAmount,
          serviceQty: row.normalized.serviceQty,
          followUpDate: row.normalized.followUpDate?.toISOString() || null,
          status: row.normalized.status,
        },
        importBatchId: batch.id,
        serviceName: row.normalized.serviceName,
        serviceAmount: row.normalized.serviceAmount,
        serviceQty: row.normalized.serviceQty,
        followUpDate: row.normalized.followUpDate,
        followUpStatus: row.analysis.followUpStatus,
        priority: row.analysis.priority,
        potentialScore: row.analysis.potentialScore,
        priorityReason: row.analysis.priorityReason,
        recommendedAction: row.analysis.recommendedAction,
        missingFields: row.analysis.missingFields,
        confidence: row.normalized.confidence,
        aiProvider: row.normalized.aiProvider,
        aiModel: row.normalized.aiModel,
        createdAt: row.normalized.createdAt || undefined,
      },
      include: { customer: true, sender: true },
    });
    createdRecords.push(record);
  }

  await prisma.demandImportBatch.update({
    where: { id: batch.id },
    data: { importedCount: createdRecords.length },
  });

  const highPriority = createdRecords.filter((record) => record.priority === "high").length;
  const missingPhone = createdRecords.filter((record) => record.missingFields.includes("phone")).length;

  return NextResponse.json({
    batchId: batch.id,
    importedCount: createdRecords.length,
    highPriority,
    missingPhone,
    detectedColumns,
    columnMapping,
    records: createdRecords.slice(0, 10).map((record) => serializeRecord(record)),
  });
}
