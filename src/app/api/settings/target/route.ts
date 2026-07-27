import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET /api/settings/target — fetch target for specific period
export async function GET(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const period = searchParams.get("period") === "custom" ? "custom" : searchParams.get("period") === "year" ? "year" : "month";
  const year = Number(searchParams.get("year"));
  const monthVal = searchParams.get("month") ? Number(searchParams.get("month")) : null;
  const rangeStart = searchParams.get("from");
  const rangeEnd = searchParams.get("to");

  if (isNaN(year)) {
    return NextResponse.json({ message: "Invalid year parameter" }, { status: 400 });
  }

  if (period === "custom" && (!rangeStart || !rangeEnd || rangeStart > rangeEnd)) {
    return NextResponse.json({ message: "A valid custom date range is required" }, { status: 400 });
  }

  const month = period === "year" ? null : monthVal;
  const customTargetWhere = period === "custom"
    ? {
        userId: session.user.id,
        period: "custom",
        rangeStart: new Date(`${rangeStart}T00:00:00.000Z`),
        rangeEnd: new Date(`${rangeEnd}T00:00:00.000Z`),
      }
    : {
        userId: session.user.id,
        period,
        year,
        month: month ?? 0,
      };

  const target = await prisma.periodTarget.findFirst({
    where: customTargetWhere,
  });

  return NextResponse.json({
    target: target || {
      targetSalesAmount: null,
      targetExpenseAmount: null,
      targetDemandCount: null,
      targetAppointments: null,
      targetNewCustomers: null,
    },
  });
}

// PUT /api/settings/target — set targets for specific period
export async function PUT(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { period, year, month: monthParam, from, to, targetSalesAmount, targetExpenseAmount, targetDemandCount, targetAppointments, targetNewCustomers } = body;

  const parsedPeriod = period === "custom" ? "custom" : period === "year" ? "year" : "month";
  const parsedYear = Number(year);
  const parsedMonth = parsedPeriod === "year" ? 0 : Number(monthParam || 1);

  if (isNaN(parsedYear)) {
    return NextResponse.json({ message: "Invalid year" }, { status: 400 });
  }
  if (parsedPeriod === "custom" && (!from || !to || from > to)) {
    return NextResponse.json({ message: "A valid custom date range is required" }, { status: 400 });
  }

  const values = {
    targetSalesAmount: targetSalesAmount === "" || targetSalesAmount == null ? null : Number(targetSalesAmount),
    targetExpenseAmount: targetExpenseAmount === "" || targetExpenseAmount == null ? null : Number(targetExpenseAmount),
    targetDemandCount: targetDemandCount === "" || targetDemandCount == null ? null : Number(targetDemandCount),
    targetAppointments: targetAppointments === "" || targetAppointments == null ? null : Number(targetAppointments),
    targetNewCustomers: targetNewCustomers === "" || targetNewCustomers == null ? null : Number(targetNewCustomers),
  };

  try {
    const updated = parsedPeriod === "custom"
      ? await (async () => {
          const rangeStart = new Date(`${from}T00:00:00.000Z`);
          const rangeEnd = new Date(`${to}T00:00:00.000Z`);
          const existing = await prisma.periodTarget.findFirst({
            where: { userId: session.user.id, period: "custom", rangeStart, rangeEnd },
          });
          return existing
            ? prisma.periodTarget.update({ where: { id: existing.id }, data: values })
            : prisma.periodTarget.create({
                data: { userId: session.user.id, period: "custom", year: rangeStart.getUTCFullYear(), month: rangeStart.getUTCMonth() + 1, rangeStart, rangeEnd, ...values },
              });
        })()
      : await prisma.periodTarget.upsert({
          where: { userId_period_year_month: { userId: session.user.id, period: parsedPeriod, year: parsedYear, month: parsedMonth } },
          create: { userId: session.user.id, period: parsedPeriod, year: parsedYear, month: parsedMonth, ...values },
          update: values,
        });

    return NextResponse.json({ target: updated });
  } catch (error) {
    console.error("Failed to save target settings:", error);
    return NextResponse.json({ message: "Failed to save targets" }, { status: 500 });
  }
}
