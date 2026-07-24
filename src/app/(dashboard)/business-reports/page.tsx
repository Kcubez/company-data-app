'use client';

import { Suspense, useState } from 'react';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import { useDateFilter, type PeriodMode } from '@/hooks/use-date-filter';
import {
  useBusinessReports,
  useBusinessReportStats,
  useBusinessReportRecommendations,
  useUpdateBusinessReport,
  useDeleteBusinessReport,
  useDeleteAllBusinessReports,
} from '@/hooks/use-business-reports';
import { BusinessReport } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { DestructiveConfirmDialog } from '@/components/ui/destructive-confirm-dialog';
import { ModalPortal } from '@/components/ui/modal-portal';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  TrendingUp,
  DollarSign,
  Trash2,
  Edit2,
  Loader2,
  Percent,
  Megaphone,
  Wallet,
  CircleAlert,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const CHANNELS = ['All', 'Facebook', 'Google', 'Referral', 'Walk-in', 'Telegram', 'Other'];
const FINANCE_TYPES = ['All', 'Income', 'Expense'];

const CHANNEL_COLORS: Record<string, string> = {
  Facebook: '#1877F2',
  Google: '#EA4335',
  Referral: '#10B981',
  'Walk-in': '#F59E0B',
  Telegram: '#0088CC',
  Other: '#6B7280',
  Unknown: '#64748B',
  Marketing: '#f59e0b',
  Infrastructure: '#64748b',
  Software: '#8b5cf6',
  Admin: '#94a3b8',
  Payroll: '#0ea5e9',
  Service: '#22c55e',
  TikTok: '#111827',
  Email: '#0ea5e9',
};

function fmt(n: number | null | undefined, prefix = '') {
  if (n == null) return '—';
  return prefix + n.toLocaleString();
}

function financeLabel(value: string) {
  const normalized = value.trim().toLowerCase();
  const labels: Record<string, string> = {
    marketing: 'Marketing',
    admin: 'Admin',
    tiktok: 'TikTok',
    infrastructure: 'Infrastructure',
    software: 'Software',
    email: 'Email',
    payroll: 'Payroll',
  };
  return labels[normalized] ?? value;
}

function extractLabeledValue(text: string | null | undefined, labels: string[]) {
  if (!text) return null;
  for (const label of labels) {
    const pattern = new RegExp(`${label}\\s*[:=-]\\s*([^\\n,]+)`, 'i');
    const match = text.match(pattern);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return null;
}

function inferFinanceCategory(record: BusinessReport, type: 'Income' | 'Expense') {
  const explicit = extractLabeledValue(record.notes, ['category', 'cat']);
  if (explicit) return explicit;
  if (type === 'Income') return 'Service';

  const haystack = `${record.notes ?? ''} ${record.marketingChannel ?? ''}`.toLowerCase();
  if (/payroll|salary|wage/.test(haystack)) return 'Payroll';
  if (/software|saas|subscription|license/.test(haystack)) return 'Software';
  if (/aws|hosting|server|infra|infrastructure|domain|cloud/.test(haystack)) return 'Infrastructure';
  if (/office|admin|supplies|utility|rent/.test(haystack)) return 'Admin';
  if (/facebook|google|ads|ad spend|marketing|campaign|ကြော်ငြာ/.test(haystack)) return 'Marketing';
  return record.marketingChannel || 'Marketing';
}

function inferFinanceDescription(record: BusinessReport, type: 'Income' | 'Expense') {
  const explicit = extractLabeledValue(record.notes, ['description', 'desc', 'item']);
  if (explicit) return explicit;
  const owner = record.reporterName ?? record.sender?.displayName ?? 'Business report';
  return type === 'Income' ? `${owner} revenue` : `${inferFinanceCategory(record, 'Expense')} expense`;
}

type FinanceType = 'All' | 'Income' | 'Expense';

function FinanceKpiCard({
  label,
  value,
  unit,
  icon: Icon,
  accentClass,
}: {
  label: string;
  value: string;
  unit?: string;
  icon: React.ComponentType<{ className?: string }>;
  accentClass?: string;
}) {
  return (
    <Card className={`bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl ${accentClass ?? ''}`}>
      <CardContent className="p-6 flex flex-col justify-center h-32">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">{label}</p>
            <h3 className="flex items-baseline gap-1.5 whitespace-nowrap text-2xl font-black text-slate-900 tracking-tight dark:text-slate-100">
              <span>{value}</span>
              {unit ? <span className="text-xs font-bold text-slate-400">{unit}</span> : null}
            </h3>
          </div>
          <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueExpenseTimeline({
  trendData,
}: {
  trendData: { label: string; revenue: number; expense: number }[];
}) {
  const maxVal = Math.max(...trendData.flatMap((item) => [item.revenue, item.expense]), 1);
  const maxMillions = Math.max(1, maxVal / 1_000_000);
  const axisMax = Math.ceil(maxMillions * 10) / 10;
  const width = 680;
  const height = 300;
  const paddingLeft = 56;
  const paddingRight = 22;
  const paddingTop = 24;
  const paddingBottom = 42;
  const innerHeight = height - paddingTop - paddingBottom;
  const pointFor = (value: number, index: number) => {
    const x = paddingLeft + (trendData.length <= 1 ? 0 : (index / (trendData.length - 1)) * (width - paddingLeft - paddingRight));
    const y = paddingTop + innerHeight - ((value / 1_000_000) / axisMax) * innerHeight;
    return `${x},${y}`;
  };
  const revenuePoints = trendData.map((item, index) => pointFor(item.revenue, index)).join(' ');
  const expensePoints = trendData.map((item, index) => pointFor(item.expense, index)).join(' ');
  const ticks = Array.from({ length: 6 }).map((_, index) => {
    const value = (axisMax / 5) * index;
    const y = paddingTop + innerHeight - (value / axisMax) * innerHeight;
    return { value, y };
  });

  if (!trendData.length) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center gap-6 text-sm font-semibold text-slate-600">
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-8 rounded-sm border-4 border-sky-500" />
          Revenue
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-4 w-8 rounded-sm border-4 border-red-500" />
          Expense
        </span>
      </div>
      <div className="relative h-80 w-full">
        <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Revenue and expense monthly line graph">
          {ticks.map((tick) => (
            <g key={tick.value}>
              <line x1={paddingLeft} x2={width - paddingRight} y1={tick.y} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={paddingLeft - 12} y={tick.y + 4} textAnchor="end" className="fill-slate-500 text-[12px] font-semibold">
                {tick.value.toFixed(1)}
              </text>
            </g>
          ))}
          <line x1={paddingLeft} x2={paddingLeft} y1={paddingTop} y2={height - paddingBottom} stroke="#cbd5e1" strokeWidth="1.5" />
          <line x1={paddingLeft} x2={width - paddingRight} y1={height - paddingBottom} y2={height - paddingBottom} stroke="#cbd5e1" strokeWidth="1.5" />
          <polyline points={revenuePoints} fill="none" stroke="#0ea5e9" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <polyline points={expensePoints} fill="none" stroke="#ef4444" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {trendData.map((item, index) => {
            const [revenueX, revenueY] = pointFor(item.revenue, index).split(',').map(Number);
            const [expenseX, expenseY] = pointFor(item.expense, index).split(',').map(Number);
            return (
              <g key={item.label}>
                <circle cx={revenueX} cy={revenueY} r="4" fill="#0ea5e9" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <circle cx={expenseX} cy={expenseY} r="4" fill="#ef4444" stroke="white" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                <text x={revenueX} y={height - 14} textAnchor="middle" className="fill-slate-500 text-[13px] font-semibold">
                  {item.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function buildMonthlyTrend(
  dailyTrend: { date: string; sales: number; budget: number; leads: number }[],
  selectedMonth: number,
  selectedYear: number,
  selectedPeriod: PeriodMode,
) {
  const monthCount = selectedPeriod === 'year' ? 12 : selectedMonth;
  const monthNames = Array.from({ length: monthCount }).map((_, index) =>
    new Date(selectedYear, index, 1).toLocaleString('en', { month: 'short' }),
  );
  const monthly = monthNames.map((label, index) => ({
    label,
    revenue: 0,
    expense: 0,
    monthIndex: index,
  }));

  for (const item of dailyTrend) {
    const date = new Date(item.date);
    if (date.getFullYear() !== selectedYear) continue;
    const monthIndex = date.getMonth();
    if (monthIndex < 0 || monthIndex >= monthly.length) continue;
    monthly[monthIndex].revenue += item.sales;
    monthly[monthIndex].expense += item.budget;
  }

  return monthly;
}

function ExpenseDonutChart({
  items,
}: {
  items: { channel: string; budget: number }[];
}) {
  const total = items.reduce((sum, item) => sum + item.budget, 0);
  const gradient = items.map((item, index) => {
    const color = CHANNEL_COLORS[financeLabel(item.channel)] ?? '#64748B';
    const start = total > 0
      ? items.slice(0, index).reduce((sum, previous) => sum + (previous.budget / total) * 100, 0)
      : 0;
    const pct = total > 0 ? (item.budget / total) * 100 : 0;
    return `${color} ${start}% ${start + pct}%`;
  }).join(', ');

  return (
    <div className="grid min-h-72 grid-cols-1 items-center gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="flex justify-center">
        <div
          className="relative h-56 w-56 rounded-full shadow-sm"
          style={{ background: `conic-gradient(${gradient})` }}
          aria-label="Expense breakdown donut chart"
        >
          <div className="absolute inset-[3.5rem] rounded-full bg-card shadow-inner" />
        </div>
      </div>
      <div className="w-full divide-y divide-slate-100 rounded-lg border border-slate-200 bg-slate-50/50 dark:divide-slate-800 dark:border-slate-800 dark:bg-slate-950/30">
        {items.map((item) => {
          const label = financeLabel(item.channel);
          const color = CHANNEL_COLORS[label] ?? '#64748B';
          const pct = total > 0 ? Math.round((item.budget / total) * 100) : 0;
          return (
            <div key={item.channel} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white shadow-sm dark:ring-slate-950" style={{ background: color }} />
                <span>{label}</span>
              </span>
              <span className="whitespace-nowrap text-right text-xs font-bold text-slate-600 dark:text-slate-300">
                {fmt(item.budget)} MMK <span className="font-medium text-slate-500">({pct}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BusinessReportsPageContent() {
  const router = useRouter();
  const {
    period,
    month,
    day,
    year,
    dateFrom,
    dateTo,
    updatePeriod,
    years,
  } = useDateFilter('finance_filter');

  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState<FinanceType>('All');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAiInsights, setShowAiInsights] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BusinessReport | null>(null);
  const [editForm, setEditForm] = useState<Partial<BusinessReport>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [lastDateFilter, setLastDateFilter] = useState(() => `${period}:${month}:${year}`);
  const limit = 10;

  const dateFilter = `${period}:${month}:${year}`;
  if (lastDateFilter !== dateFilter) {
    setLastDateFilter(dateFilter);
    setPage(1);
  }

  const listParams = {
    page,
    limit,
    channel: channelFilter !== 'All' ? channelFilter : undefined,
    dateFrom,
    dateTo,
  };

  const { data, isLoading } = useBusinessReports(listParams);
  const { data: statsData, isLoading: statsLoading } = useBusinessReportStats({
    dateFrom,
    dateTo,
  });
  const { data: yearStatsData, isLoading: yearStatsLoading } = useBusinessReportStats({
    dateFrom: `${year}-01-01`,
    dateTo: `${year}-12-31`,
  });
  const {
    data: recsData,
    isLoading: recsLoading,
    isFetching: recsFetching,
  } = useBusinessReportRecommendations();

  const updateMutation = useUpdateBusinessReport();
  const deleteMutation = useDeleteBusinessReport();
  const deleteAllMutation = useDeleteAllBusinessReports();
  const visibleInsights = recsData?.recommendations.slice(0, 2) || [];

  const s = statsData;
  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);
  const totalRevenue = s?.totalSales ?? 0;
  const totalExpense = s?.totalBudget ?? 0;
  const profitLoss = totalRevenue - totalExpense;
  const profitMargin = totalRevenue > 0 ? Math.round((profitLoss / totalRevenue) * 100) : 0;
  const expenseBreakdown = s?.channelPerformance?.filter((ch) => ch.budget > 0) ?? [];
  const monthlyTrend = buildMonthlyTrend(yearStatsData?.dailyTrend ?? [], month, year, period);
  const financeRows = records.flatMap((r) => {
    const rows: {
      id: string;
      report: BusinessReport;
      date: string;
      description: string;
      category: string;
      type: 'Income' | 'Expense';
      amount: number;
    }[] = [];

    if ((r.totalSalesAmount ?? 0) > 0) {
      rows.push({
        id: `${r.id}-income`,
        report: r,
        date: r.reportDate,
        description: inferFinanceDescription(r, 'Income'),
        category: inferFinanceCategory(r, 'Income'),
        type: 'Income',
        amount: r.totalSalesAmount ?? 0,
      });
    }

    if ((r.marketingBudget ?? 0) > 0) {
      rows.push({
        id: `${r.id}-expense`,
        report: r,
        date: r.reportDate,
        description: inferFinanceDescription(r, 'Expense'),
        category: inferFinanceCategory(r, 'Expense'),
        type: 'Expense',
        amount: -(r.marketingBudget ?? 0),
      });
    }

    return rows;
  }).filter((row) => typeFilter === 'All' || row.type === typeFilter);

  const computedFinanceInsights = [
    {
      tone: profitLoss >= 0 ? 'success' : 'warning',
      title: profitLoss >= 0 ? 'Profit Margin Optimization' : 'Profit Pressure Warning',
      insight: profitLoss >= 0
        ? `This period is profitable by ${profitLoss.toLocaleString()} MMK with a ${profitMargin}% margin. Keep expense growth below revenue growth.`
        : `Expenses exceed revenue by ${Math.abs(profitLoss).toLocaleString()} MMK this period. Review high-spend channels before scaling budget.`,
    },
    {
      tone: s?.roi && s.roi >= 0 ? 'success' : 'warning',
      title: 'Expense Efficiency Watch',
      insight: `Marketing expense is ${totalExpense.toLocaleString()} MMK against ${totalRevenue.toLocaleString()} MMK revenue. Current ROI is ${s?.roi ?? 0}%.`,
    },
  ];
  const financeInsights = (visibleInsights.length > 0
    ? visibleInsights.slice(0, 2).map((rec, index) => ({
        tone: index === 0 ? 'success' : 'warning',
        title: rec.title,
        insight: rec.insight,
        action: rec.action,
        actionType: rec.actionType,
      }))
    : computedFinanceInsights.map((rec) => ({
        ...rec,
        action: rec.tone === 'success' ? 'မှတ်တမ်းများကြည့်ရန်' : 'ဘတ်ဂျက်စစ်ဆေးရန်',
        actionType: 'view_finance_table' as const,
      })));

  // Edit helpers
  const openEdit = (r: BusinessReport) => {
    setEditingRecord(r);
    setEditForm({
      reportDate: r.reportDate ? r.reportDate.slice(0, 10) : '',
      reporterName: r.reporterName ?? '',
      marketingBudget: r.marketingBudget,
      marketingChannel: r.marketingChannel ?? '',
      callsMade: r.callsMade,
      appointmentsMade: r.appointmentsMade,
      appointmentsKept: r.appointmentsKept,
      newLeads: r.newLeads,
      totalDemandCount: r.totalDemandCount,
      totalSalesAmount: r.totalSalesAmount,
      closedDeals: r.closedDeals,
      pendingDeals: r.pendingDeals,
      targetSalesAmount: r.targetSalesAmount,
      targetDemandCount: r.targetDemandCount,
      targetAppointments: r.targetAppointments,
      notes: r.notes ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editingRecord) return;
    await updateMutation.mutateAsync({ id: editingRecord.id, data: editForm });
    setEditingRecord(null);
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Wallet className="h-7 w-7 text-sky-600 dark:text-sky-400" />
            Finance Department
          </h1>
          <p className="text-muted-foreground">
            Financial records, reporting, and cash flow.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={period} onValueChange={(value) => {
            if (value === 'overall' || value === 'day' || value === 'month' || value === 'year') {
              updatePeriod({ period: value });
            }
          }}>
            <SelectTrigger className="h-9 w-28 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
              {period === 'overall' ? 'Overall' : period === 'year' ? 'Yearly' : period === 'day' ? 'Daily' : 'Monthly'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overall">Overall</SelectItem>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="year">Yearly</SelectItem>
            </SelectContent>
          </Select>
          {period === 'day' ? (
            <Input
              type="date"
              value={`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
              onChange={(event) => {
                const next = new Date(`${event.target.value}T00:00:00`);
                if (!Number.isNaN(next.getTime())) updatePeriod({ year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() });
              }}
              className="h-9 w-40 rounded-lg border-2 border-slate-300 bg-card text-xs font-bold dark:border-slate-800"
              aria-label="Select day"
            />
          ) : period === 'month' ? (
            <Select value={String(month)} onValueChange={(value) => {
              if (value) {
                updatePeriod({ month: Number(value) });
              }
            }}>
              <SelectTrigger className="h-9 w-32 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
                {new Date(year, month - 1, 1).toLocaleString('en', { month: 'long' })}
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }).map((_, index) => (
                  <SelectItem key={index + 1} value={String(index + 1)}>
                    {new Date(year, index, 1).toLocaleString('en', { month: 'long' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {period !== 'day' && period !== 'overall' && <Select value={String(year)} onValueChange={(value) => {
            if (value) {
              updatePeriod({ year: Number(value) });
            }
          }}>
            <SelectTrigger className="h-9 w-24 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
              {year}
            </SelectTrigger>
            <SelectContent>
              {years.map((itemYear) => (
                <SelectItem key={itemYear} value={String(itemYear)}>
                  {itemYear}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleteAllMutation.isPending}
            className="h-9 border-2 border-red-200 bg-red-50 text-xs font-bold text-red-700 hover:bg-red-100 hover:text-red-800 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Delete All
          </Button>
        </div>
      </div>

      {/* ─── Delete All Confirm ───────────────────────────────────────── */}
      {showDeleteConfirm && (
        <DestructiveConfirmDialog
          title="Delete business report records for selected period?"
          description={
            <>
              This moves{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                {total} business report record(s) from {dateFrom} to {dateTo}
              </span>
              {' '}to Trash. Admins can restore them later or permanently delete them from Trash.
            </>
          }
          confirmationText="confirm"
          confirmationLabel="Type confirm to move these records to Trash"
          isPending={deleteAllMutation.isPending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            await deleteAllMutation.mutateAsync({ dateFrom, dateTo });
            setShowDeleteConfirm(false);
          }}
        />
      )}

      {/* ─── KPI Cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statsLoading ? (
          [...Array(4)].map((_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)
        ) : (
          <>
            <FinanceKpiCard
              label="Total Revenue"
              value={fmt(totalRevenue)}
              unit="MMK"
              icon={DollarSign}
              accentClass="border-l-4 border-l-sky-500"
            />
            <FinanceKpiCard
              label="Total Expense"
              value={fmt(totalExpense)}
              unit="MMK"
              icon={Megaphone}
              accentClass="border-l-4 border-l-red-500"
            />
            <FinanceKpiCard
              label="Profit / Loss"
              value={`${profitLoss >= 0 ? '+' : ''}${fmt(profitLoss)}`}
              unit="MMK"
              icon={TrendingUp}
              accentClass={profitLoss >= 0 ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-amber-500'}
            />
            <FinanceKpiCard
              label="Profit Margin"
              value={`${profitMargin}%`}
              icon={Percent}
              accentClass={profitMargin >= 0 ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-amber-500'}
            />
          </>
        )}
      </div>

      {/* ─── AI Insights ────────────────────────────────────────────── */}
      {!(totalRevenue === 0 && totalExpense === 0) && (
        <Card className="rounded-xl border-2 border-sky-200 bg-sky-50/40 shadow-sm dark:border-sky-900 dark:bg-sky-950/20">
          <CardHeader className="py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="text-sm font-bold text-slate-900 dark:text-slate-100">AI Finance Suggestions</CardTitle>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Review recommendations based on the selected period.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowAiInsights((show) => !show)} className="cursor-pointer">
                {showAiInsights ? 'Hide suggestions' : 'View suggestions'}
                {showAiInsights ? <ChevronUp className="ml-1.5 h-4 w-4" /> : <ChevronDown className="ml-1.5 h-4 w-4" />}
              </Button>
            </div>
          </CardHeader>
          {showAiInsights && <CardContent className="grid grid-cols-1 gap-4 pt-0 md:grid-cols-2">
          {recsLoading || recsFetching ? (
            <>
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </>
          ) : financeInsights.map((insight, index) => {
            const isSuccess = insight.tone === 'success';
            const Icon = isSuccess ? TrendingUp : CircleAlert;
            return (
              <Card
                key={`${insight.title}-${index}`}
                className={`bg-card border-2 ${isSuccess ? 'border-emerald-300 border-l-8 border-l-emerald-500' : 'border-amber-300 border-l-8 border-l-amber-500'} rounded-xl shadow-sm flex flex-col justify-between`}
              >
                <CardContent className="p-5 flex flex-col h-full justify-between">
                  <div>
                    <div className="mb-2 flex items-center gap-3">
                      <Icon className={`h-5 w-5 ${isSuccess ? 'text-emerald-600' : 'text-amber-600'}`} />
                      <h4 className="font-bold text-slate-900 dark:text-slate-100">{insight.title}</h4>
                    </div>
                    <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">{insight.insight}</p>
                  </div>
                  {insight.action && (
                    <div className="mt-4">
                      <Button
                        variant={isSuccess ? 'outline' : 'destructive'}
                        size="sm"
                        onClick={() => {
                          if (insight.actionType === 'view_sales_marketing') {
                            router.push('/sales-marketing#report-table-section');
                          } else if (insight.actionType === 'view_customer_service') {
                            router.push('/customer-service#demand-leads-section');
                          } else if (insight.actionType === 'view_finance_table') {
                            const el = document.getElementById('finance-records-table');
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                          } else {
                            router.push('/dashboard');
                          }
                        }}
                        className={`${
                          isSuccess
                            ? 'border-emerald-250 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800'
                            : 'bg-amber-600 hover:bg-amber-700 text-white border-none'
                        } text-xs font-bold transition shadow-sm rounded-lg px-4 h-9 cursor-pointer`}
                      >
                        {insight.action}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
          </CardContent>}
        </Card>
      )}

      {/* ─── Finance Charts ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-xl border-2 border-slate-200 bg-card shadow-sm dark:border-slate-800">
          <CardHeader>
            <CardTitle className="border-b-2 border-slate-100 pb-3 text-sm font-bold uppercase tracking-wide text-slate-900 dark:border-slate-800 dark:text-slate-100">
              Revenue vs Expense Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            {yearStatsLoading ? <Skeleton className="h-72 w-full" /> : monthlyTrend.every((item) => item.revenue === 0 && item.expense === 0) ? (
              <p className="py-12 text-center text-sm text-slate-500">No timeline data yet.</p>
            ) : <RevenueExpenseTimeline trendData={monthlyTrend} />}
          </CardContent>
        </Card>
        <Card className="rounded-xl border-2 border-slate-200 bg-card shadow-sm dark:border-slate-800">
          <CardHeader>
            <CardTitle className="border-b-2 border-slate-100 pb-3 text-sm font-bold uppercase tracking-wide text-slate-900 dark:border-slate-800 dark:text-slate-100">
              Expense Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {statsLoading ? <Skeleton className="h-72 w-full" /> : expenseBreakdown.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">No expense breakdown yet.</p>
            ) : <ExpenseDonutChart items={expenseBreakdown.slice(0, 6)} />}
          </CardContent>
        </Card>
      </div>

      {/* ─── Finance Records ────────────────────────────────────────── */}
      <Card id="finance-records-table" className="overflow-hidden rounded-xl border-2 border-slate-200 bg-card shadow-sm dark:border-slate-800">
        <CardHeader className="border-b-2 border-slate-200 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle className="text-sm font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                Finance Records
              </CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={typeFilter}
                onValueChange={(value) => { setTypeFilter((value as FinanceType) ?? 'All'); setPage(1); }}
              >
                <SelectTrigger className="h-9 w-32 rounded border-2 border-slate-300 bg-card text-xs font-bold text-slate-800 dark:border-slate-800 dark:text-slate-200">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  {FINANCE_TYPES.map((type) => (
                    <SelectItem key={type} value={type} className="text-xs">{type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={channelFilter}
                onValueChange={(value) => { setChannelFilter(value ?? 'All'); setPage(1); }}
              >
                <SelectTrigger className="h-9 w-36 rounded border-2 border-slate-300 bg-card text-xs font-bold text-slate-800 dark:border-slate-800 dark:text-slate-200">
                  <SelectValue placeholder="Channel" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((channel) => (
                    <SelectItem key={channel} value={channel} className="text-xs">{channel}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b-2 border-slate-200 bg-card text-[10px] font-extrabold uppercase tracking-wider text-slate-500 dark:border-slate-800">
                <tr>
                  {['Date', 'Description', 'Category', 'Type', 'Amount (MMK)', 'Actions'].map((heading) => (
                    <th key={heading} className={`px-6 py-4 ${heading === 'Amount (MMK)' ? 'text-right' : heading === 'Actions' ? 'text-center' : 'text-left'}`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-slate-100 dark:divide-slate-900">
                {isLoading ? (
                  [...Array(5)].map((_, index) => (
                    <tr key={index}>
                      {[...Array(6)].map((__, cellIndex) => (
                        <td key={cellIndex} className="px-6 py-4">
                          <Skeleton className="h-4 w-20" />
                        </td>
                      ))}
                    </tr>
                  ))
                ) : financeRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-10 text-center text-sm text-slate-500">
                      No finance records found for this period.
                    </td>
                  </tr>
                ) : (
                  financeRows.map((row) => (
                    <tr key={row.id} className="transition hover:bg-slate-50 dark:hover:bg-slate-950/50">
                      <td className="whitespace-nowrap px-6 py-4 text-xs font-bold text-slate-600 dark:text-slate-400">
                        {format(new Date(row.date), 'yyyy-MM-dd')}
                      </td>
                      <td className="px-6 py-4 text-xs font-bold text-slate-900 dark:text-slate-100">
                        {row.description}
                      </td>
                      <td className="px-6 py-4 text-xs font-semibold text-slate-500">{financeLabel(row.category)}</td>
                      <td className="px-6 py-4">
                        <Badge
                          variant="outline"
                          className={`rounded border-2 px-2.5 py-1 text-[10px] font-extrabold ${
                            row.type === 'Income'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-300'
                              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300'
                          }`}
                        >
                          {row.type.toUpperCase()}
                        </Badge>
                      </td>
                      <td className={`whitespace-nowrap px-6 py-4 text-right text-sm font-black ${row.amount >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-700 dark:text-red-300'}`}>
                        {row.amount >= 0 ? '+' : '-'}{Math.abs(row.amount).toLocaleString()}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-blue-600 hover:text-blue-700"
                            onClick={() => openEdit(row.report)}
                            aria-label="Edit finance source record"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </Button>
                          {deleteConfirmId === row.report.id ? (
                            <div className="flex gap-1">
                              <Button
                                size="icon"
                                className="h-7 w-7 bg-red-600 text-white hover:bg-red-700"
                                disabled={deleteMutation.isPending}
                                onClick={async () => {
                                  await deleteMutation.mutateAsync(row.report.id);
                                  setDeleteConfirmId(null);
                                }}
                                aria-label="Confirm delete finance source record"
                              >
                                {deleteMutation.isPending ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  '✓'
                                )}
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-slate-500"
                                onClick={() => setDeleteConfirmId(null)}
                                aria-label="Cancel delete finance source record"
                              >
                                ✕
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-red-600 hover:text-red-700"
                              onClick={() => setDeleteConfirmId(row.report.id)}
                              aria-label="Delete finance source record"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t-2 border-slate-200 bg-slate-50/60 px-6 py-5 dark:border-slate-800 dark:bg-slate-950/40">
              <span className="text-xs font-bold text-slate-500">Page {page} of {totalPages}</span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-2 border-slate-300 bg-card text-xs font-bold"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 border-2 border-slate-300 bg-card text-xs font-bold"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── Edit Dialog ────────────────────────────────────────────── */}
      {editingRecord && (
        <ModalPortal className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-foreground">Edit Business Report</h3>
              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => setEditingRecord(null)}>
                ✕
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                { label: 'Date', key: 'reportDate', type: 'date' },
                { label: 'Reporter', key: 'reporterName', type: 'text', colSpan: true },
                { label: 'Marketing Budget (Ks)', key: 'marketingBudget', type: 'number' },
                { label: 'Calls Made', key: 'callsMade', type: 'number' },
                { label: 'Appointments Made', key: 'appointmentsMade', type: 'number' },
                { label: 'Appointments Kept', key: 'appointmentsKept', type: 'number' },
                { label: 'New Leads', key: 'newLeads', type: 'number' },
                { label: 'Total Demand Count', key: 'totalDemandCount', type: 'number' },
                { label: 'Total Sales (Ks)', key: 'totalSalesAmount', type: 'number' },
                { label: 'Closed Deals', key: 'closedDeals', type: 'number' },
                { label: 'Pending Deals', key: 'pendingDeals', type: 'number' },
                { label: 'Target Sales (Ks)', key: 'targetSalesAmount', type: 'number' },
                { label: 'Target Demand Count', key: 'targetDemandCount', type: 'number' },
                { label: 'Target Appointments', key: 'targetAppointments', type: 'number' },
              ].map(({ label, key, type, colSpan }) => (
                <div key={key} className={colSpan ? 'col-span-2' : ''}>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">{label}</label>
                  <Input
                    type={type}
                    className="h-8 text-xs bg-muted border-border text-foreground"
                    value={(editForm[key as keyof BusinessReport] as string | number | undefined) ?? ''}
                    onChange={(e) => {
                      const val = type === 'number'
                        ? (e.target.value === '' ? null : Number(e.target.value))
                        : e.target.value;
                      setEditForm((f) => ({ ...f, [key]: val }));
                    }}
                  />
                </div>
              ))}

              {/* Channel select */}
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">Channel</label>
                <Select
                  value={editForm.marketingChannel ?? ''}
                  onValueChange={(v) => setEditForm((f) => ({ ...f, marketingChannel: v }))}
                >
                  <SelectTrigger className="h-8 text-xs bg-muted border-border text-foreground">
                    <SelectValue placeholder="Channel" />
                  </SelectTrigger>
                  <SelectContent>
                    {['Facebook', 'Google', 'Referral', 'Walk-in', 'Telegram', 'Other'].map((c) => (
                      <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Notes full width */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label>
                <textarea
                  className="w-full rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground min-h-17.5 resize-y focus:outline-none focus:ring-1 focus:ring-blue-500"
                  value={(editForm.notes as string | undefined) ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" className="border-border text-foreground" onClick={() => setEditingRecord(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={updateMutation.isPending} className="bg-blue-600 hover:bg-blue-700 text-white" onClick={saveEdit}>
                {updateMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : null}
                Save Changes
              </Button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

export default function BusinessReportsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <BusinessReportsPageContent />
    </Suspense>
  );
}
