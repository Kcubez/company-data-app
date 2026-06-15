'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Users,
  Activity,
  TrendingUp,
  Bot,
  CheckCircle2,
  Banknote,
  ArrowRight,
  Wallet,
  Lightbulb,
  Megaphone,
  UserCheck,
  CalendarCheck,
  Zap,
} from 'lucide-react';

type WeeklyActivity = {
  date: string;
  count: number;
};

type FinancialTrend = {
  label: string;
  revenue: number;
  expense: number;
  profit: number;
};

type TopProduct = {
  product: string;
  count: number;
  totalQty: number;
  revenue: number;
};

type DueTodayRecord = {
  id: string;
  customerName: string | null;
  product: string | null;
  quantity: number | null;
  status: string;
  note: string;
  senderName: string;
  followUpDate: string | null;
};

type PeriodMode = 'month' | 'year';

type DashboardStats = {
  totalMessages: number;
  todayMessages: number;
  totalSenders: number;
  weekMessages: number;
  todayDemandRecords: number;
  dueTodayFollowUps: number;
  pendingDemandRecords: number;
  totalCustomers: number;
  botActive: boolean;
  recentMessages: {
    id: string;
    text: string;
    senderName: string;
    senderUsername: string | null;
    receivedAt: string;
  }[];
  isAdmin: boolean;
  adminStats: {
    totalUsers: number;
    activeSessions: number;
  } | null;
  totalQuantitySold: number;
  totalAmountSold: number;
  totalCost: number;
  profitLoss: number;
  roi: number | null;
  period: PeriodMode;
  selectedMonth: number;
  selectedYear: number;
  highPriorityLeads: number;
  missingPhoneLeads: number;
  weeklyActivity: WeeklyActivity[];
  topProducts: TopProduct[];
  dueTodayRecords: DueTodayRecord[];
  targetDemandCount: number | null;
  targetAppointments: number | null;
  targetSalesAmount: number | null;
  actualRevenue: number;
  actualDemandCount: number;
  actualAppointments: number;
  expectedRevenue: number | null;
  expectedDemandCount: number | null;
  expectedAppointments: number | null;
  elapsedRatio: number;
  elapsedDays: number;
  totalDaysInPeriod: number;
  financialTrend: FinancialTrend[];
  salesFunnel: {
    leads: number;
    appointments: number;
    closedDeals: number;
    appointmentConversionRate: number | null;
    closeConversionRate: number | null;
  };
  risks: {
    overdueFollowUps: number;
    highPriorityLeads: number;
    missingPhoneLeads: number;
    dueTodayFollowUps: number;
  };
  alerts: {
    type: 'revenue_target' | 'demand_target' | 'appointments_target';
    status: 'warning' | 'info';
    message: string;
    actual: number;
    expected: number;
    target: number;
  }[];
};

function useDashboardStats(period: PeriodMode, month: number, year: number) {
  return useQuery({
    queryKey: ['dashboard-stats', period, month, year],
    queryFn: async (): Promise<DashboardStats> => {
      const res = await fetch(`/api/dashboard/stats?period=${period}&month=${month}&year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 10000,
  });
}

type ActionRecommendation = {
  area: 'marketing' | 'sales' | 'appointments' | 'general';
  severity: 'urgent' | 'warning' | 'info';
  title: string;
  insight: string;
  action: string;
};

function useActionRecommendations(period: PeriodMode, month: number, year: number) {
  return useQuery({
    queryKey: ['action-recommendations', period, month, year],
    queryFn: async (): Promise<{ recommendations: ActionRecommendation[] }> => {
      const res = await fetch(`/api/dashboard/action-recommendations?period=${period}&month=${month}&year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    // Refresh every 2 minutes so newly imported demand records / business reports
    // are reflected quickly without hammering Gemini on every 10s poll.
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}

function FinancialTrendChart({ data }: { data?: FinancialTrend[] }) {
  if (!data || data.length === 0) return null;

  const maxValue = Math.max(
    ...data.flatMap(item => [item.revenue, item.expense, Math.abs(item.profit)]),
    1,
  );

  return (
    <div className="overflow-x-auto pb-1">
      <div className="min-w-[720px]">
        <div className="flex items-end gap-2 h-56 px-1">
          {data.map(item => {
            const revenueHeight = Math.max((item.revenue / maxValue) * 100, item.revenue > 0 ? 6 : 2);
            const expenseHeight = Math.max((item.expense / maxValue) * 100, item.expense > 0 ? 6 : 2);
            const profitHeight = Math.max((Math.abs(item.profit) / maxValue) * 100, item.profit !== 0 ? 6 : 2);
            const profitColor = item.profit >= 0 ? 'bg-emerald-500' : 'bg-red-500';

            return (
              <div key={item.label} className="flex-1 min-w-5 flex flex-col items-center gap-2 h-full">
                <div className="flex flex-1 items-end gap-1 w-full">
                  <div
                    className="flex-1 rounded-t bg-emerald-500/80 transition-colors duration-200 hover:bg-emerald-500"
                    style={{ height: `${revenueHeight}%` }}
                    title={`Revenue: ${item.revenue.toLocaleString()} Ks`}
                  />
                  <div
                    className="flex-1 rounded-t bg-rose-500/75 transition-colors duration-200 hover:bg-rose-500"
                    style={{ height: `${expenseHeight}%` }}
                    title={`Expense: ${item.expense.toLocaleString()} Ks`}
                  />
                  <div
                    className={`flex-1 rounded-t ${profitColor} transition-opacity duration-200 hover:opacity-80`}
                    style={{ height: `${profitHeight}%` }}
                    title={`Profit/Loss: ${item.profit.toLocaleString()} Ks`}
                  />
                </div>
                <span className="text-[10px] font-semibold text-muted-foreground font-mono">{item.label}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-emerald-500" />Revenue</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-rose-500" />Expense</span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm bg-emerald-500" />
            <span className="h-2 w-2 rounded-sm bg-red-500" />
            Profit/Loss
          </span>
        </div>
      </div>
    </div>
  );
}

function DashboardPageContent() {
  const { data: session } = useSession();
  const now = new Date();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const period: PeriodMode = searchParams.get('period') === 'year' ? 'year' : 'month';
  const month = Math.min(
    12,
    Math.max(1, Number(searchParams.get('month') || now.getMonth() + 1)),
  );
  const year = Number(searchParams.get('year') || now.getFullYear());
  const { data: stats, isLoading } = useDashboardStats(period, month, year);
  const { data: recsData, isLoading: recsLoading } = useActionRecommendations(period, month, year);
  const [localPeriod, setLocalPeriod] = useState<PeriodMode>(period);
  const [localMonth, setLocalMonth] = useState(String(month));
  const [localYear, setLocalYear] = useState(String(year));

  useEffect(() => {
    setLocalPeriod(period);
    setLocalMonth(String(month));
    setLocalYear(String(year));
  }, [period, month, year]);

  const user = session?.user;
  const isAdmin = stats?.isAdmin ?? false;
  const years = Array.from({ length: 5 }).map((_, index) => now.getFullYear() - 2 + index);

  const updatePeriod = (next: { period?: PeriodMode; month?: number; year?: number }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('period', next.period ?? period);
    params.set('month', String(next.month ?? month));
    params.set('year', String(next.year ?? year));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const hasPeriod = searchParams.has('period');
    const hasMonth = searchParams.has('month');
    const hasYear = searchParams.has('year');

    if (!hasPeriod || !hasMonth || !hasYear) {
      const storedPeriod = localStorage.getItem('dashboard_filter_period') as PeriodMode | null;
      const storedMonth = localStorage.getItem('dashboard_filter_month');
      const storedYear = localStorage.getItem('dashboard_filter_year');

      if ((storedPeriod === 'month' || storedPeriod === 'year') && storedMonth && storedYear) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('period', storedPeriod);
        params.set('month', storedMonth);
        params.set('year', storedYear);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      } else {
        localStorage.setItem('dashboard_filter_period', period);
        localStorage.setItem('dashboard_filter_month', String(month));
        localStorage.setItem('dashboard_filter_year', String(year));
      }
    } else {
      localStorage.setItem('dashboard_filter_period', period);
      localStorage.setItem('dashboard_filter_month', String(month));
      localStorage.setItem('dashboard_filter_year', String(year));
    }
  }, [searchParams, pathname, router, period, month, year]);

  const heroCards = [
    {
      title: 'Total Revenue',
      value: stats?.totalAmountSold ?? 0,
      suffix: ' Ks',
      icon: Banknote,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
    },
    {
      title: 'Total Expense',
      value: stats?.totalCost ?? 0,
      suffix: ' Ks',
      icon: Wallet,
      color: 'text-rose-600 dark:text-rose-400',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
    },
    {
      title: 'Profit / Loss',
      value: stats?.profitLoss ?? 0,
      suffix: ' Ks',
      icon: TrendingUp,
      color:
        (stats?.profitLoss ?? 0) >= 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400',
      bg: (stats?.profitLoss ?? 0) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10',
      border: (stats?.profitLoss ?? 0) >= 0 ? 'border-emerald-500/20' : 'border-red-500/20',
    },
    {
      title: 'ROI',
      value: stats?.roi ?? null,
      suffix: '%',
      icon: Activity,
      color:
        (stats?.roi ?? 0) >= 0
          ? 'text-blue-600 dark:text-blue-400'
          : 'text-red-600 dark:text-red-400',
      bg: (stats?.roi ?? 0) >= 0 ? 'bg-blue-500/10' : 'bg-red-500/10',
      border: (stats?.roi ?? 0) >= 0 ? 'border-blue-500/20' : 'border-red-500/20',
    },
  ];

  // Admin gets extra cards
  if (isAdmin) {
    heroCards.push(
      {
        title: 'Account Users',
        value: stats?.adminStats?.totalUsers ?? 0,
        suffix: '',
        icon: Users,
        color: 'text-cyan-600 dark:text-cyan-400',
        bg: 'bg-cyan-500/10',
        border: 'border-cyan-500/20',
      },
      {
        title: 'Active Sessions',
        value: stats?.adminStats?.activeSessions ?? 0,
        suffix: '',
        icon: Activity,
        color: 'text-rose-600 dark:text-rose-400',
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/20',
      }
    );
  }

  const hasFinancialStats = !isLoading && !!stats;
  const isProfitable = (stats?.profitLoss ?? 0) >= 0;
  const roiValue = stats?.roi ?? null;
  const periodText = period === 'year' ? 'ဒီနှစ်' : 'ဒီလ';
  const periodTitle = period === 'year' ? 'This Year' : 'This Month';
  const dayLabel = period === 'year' ? 'Year Day' : 'Day';
  const moneySummary = stats
    ? stats.totalCost > 0
      ? isProfitable
        ? `${periodText}မှာ ${stats.profitLoss.toLocaleString()} Ks အမြတ်ရှိပြီး ROI ${
            roiValue !== null ? roiValue.toLocaleString(undefined, { maximumFractionDigits: 1 }) : 'N/A'
          }% ရနေပါတယ်။`
        : `${periodText}မှာ ${Math.abs(stats.profitLoss).toLocaleString()} Ks အရှုံးရှိနေပါတယ်။ Expense နဲ့ sales conversion ကို ပြန်စစ်သင့်ပါတယ်။`
      : stats.totalAmountSold > 0
        ? `${periodText}မှာ revenue ${stats.totalAmountSold.toLocaleString()} Ks ရှိပြီး expense data မရှိသေးပါ။ ROI တွက်ရန် marketing budget ထည့်ရန်လိုပါတယ်။`
        : `${periodText}အတွက် revenue နဲ့ expense data မရှိသေးပါ။ Business report data ဝင်လာမှ financial health ပြမယ်။`
    : '';
  const targetSummary = stats?.alerts?.length
    ? `Action needed: ${periodText} ${stats.elapsedDays}/${stats.totalDaysInPeriod} ရက် ကုန်ဆုံးပြီ။ ${stats.alerts.length} ကဏ္ဍ target pace နောက်ကျနေပါတယ်။`
    : 'Target pace ကောင်းနေပါတယ်။ ဒီနေ့ follow-up workflow ကိုသာ ဆက်ထိန်းပါ။';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold  text-foreground mb-1 font-heading">
            MOT Business Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Important revenue, expense, profit/loss, and ROI signals for {user?.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Select value={localPeriod} onValueChange={(value) => {
            if (value === 'month' || value === 'year') {
              setLocalPeriod(value);
              updatePeriod({ period: value });
            }
          }}>
            <SelectTrigger className="h-9 w-28 rounded-lg border-border bg-card text-xs">
              {localPeriod === 'year' ? 'Yearly' : 'Monthly'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="year">Yearly</SelectItem>
            </SelectContent>
          </Select>
          {localPeriod === 'month' ? (
            <Select value={localMonth} onValueChange={(value) => {
              if (value) {
                setLocalMonth(value);
                updatePeriod({ month: Number(value) });
              }
            }}>
              <SelectTrigger className="h-9 w-32 rounded-lg border-border bg-card text-xs">
                {new Date(Number(localYear), Number(localMonth) - 1, 1).toLocaleString('en', { month: 'long' })}
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }).map((_, index) => (
                  <SelectItem key={index + 1} value={String(index + 1)}>
                    {new Date(Number(localYear), index, 1).toLocaleString('en', { month: 'long' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={localYear} onValueChange={(value) => {
            if (value) {
              setLocalYear(value);
              updatePeriod({ year: Number(value) });
            }
          }}>
            <SelectTrigger className="h-9 w-24 rounded-lg border-border bg-card text-xs">
              {localYear}
            </SelectTrigger>
            <SelectContent>
              {years.map((itemYear) => (
                <SelectItem key={itemYear} value={String(itemYear)}>
                  {itemYear}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Business Health Summary */}
      <Card className={`glass-card border-border/70 shadow-sm overflow-hidden ${stats?.alerts?.length ? 'border-red-500/25' : ''}`}>
        <CardHeader className="pb-4 border-b border-border/60">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base font-bold text-foreground font-heading">
                Business Health {periodTitle}
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Revenue, expense, profit/loss, ROI, and target action in one view
              </CardDescription>
            </div>
            {hasFinancialStats ? (
              <Badge
                className={`w-fit border text-xs font-bold ${
                  stats.alerts.length
                    ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
                    : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                }`}
              >
                {stats.alerts.length ? 'Action Needed' : 'On Track'}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {heroCards.slice(0, 4).map((stat, i) => (
              <div key={i} className={`rounded-lg border ${stat.border} ${stat.bg} p-3.5 space-y-3`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase text-muted-foreground font-heading">
                    {stat.title}
                  </span>
                  <div className="rounded-md bg-background/70 p-1.5">
                    <stat.icon className={`h-4 w-4 ${stat.color}`} />
                  </div>
                </div>
                {isLoading ? (
                  <Skeleton className="h-8 w-24 bg-muted" />
                ) : (
                  <div className={`text-2xl font-bold font-mono leading-none ${stat.color}`}>
                    {typeof stat.value === 'number'
                      ? stat.value.toLocaleString(undefined, {
                          maximumFractionDigits: stat.title === 'ROI' ? 1 : 0,
                        })
                      : 'N/A'}
                    {typeof stat.value === 'number' && stat.suffix && (
                      <span className="ml-1 text-xs font-sans text-muted-foreground">{stat.suffix}</span>
                    )}
                  </div>
                )}
                {stat.title === 'Total Revenue' && stats?.targetSalesAmount ? (
                  <div className="space-y-1">
                    <div className="flex justify-between text-[10px] text-muted-foreground font-semibold font-mono">
                      <span>{dayLabel}: {stats.elapsedDays}/{stats.totalDaysInPeriod}</span>
                      <span>Goal: {Math.round((stats.totalAmountSold / stats.targetSalesAmount) * 100)}%</span>
                    </div>
                    <div className="h-1 w-full bg-background/70 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${Math.min(100, (stats.totalAmountSold / stats.targetSalesAmount) * 100)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {isLoading ? (
            <Skeleton className="h-24 w-full bg-muted rounded-lg" />
          ) : (
            <div
              className={`rounded-lg border p-4 ${
                stats?.alerts?.length
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-emerald-500/20 bg-emerald-500/5'
              }`}
            >
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <div
                      className={`rounded-md p-1.5 ${
                        stats?.alerts?.length ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-500'
                      }`}
                    >
                      {stats?.alerts?.length ? <ArrowRight className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                    </div>
                    <p
                      className={`text-sm font-bold font-heading ${
                        stats?.alerts?.length ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
                      }`}
                    >
                      {stats?.alerts?.length ? 'Target Alert' : 'Healthy Pace'}
                    </p>
                  </div>
                  <p className="text-sm text-foreground leading-relaxed">{moneySummary}</p>
                  <p className="text-xs text-muted-foreground">{targetSummary}</p>
                </div>
              </div>

              {stats?.alerts && stats.alerts.length > 0 ? (
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  {stats.alerts.map((alert) => {
                    const actualVal = alert.actual;
                    const targetVal = alert.target;
                    const expectedVal = alert.expected;
                    const remaining = targetVal - actualVal;
                    const achievedPct = targetVal > 0 ? Math.round((actualVal / targetVal) * 100) : 0;
                    const expectedPct = targetVal > 0 ? Math.round((expectedVal / targetVal) * 100) : 0;
                    const isRevenue = alert.type === 'revenue_target';
                    const metricLabel = {
                      revenue_target: 'Revenue',
                      demand_target: 'Lead / Messages',
                      appointments_target: 'Appointment',
                    }[alert.type];
                    const actionLabel = {
                      revenue_target: 'High-potential lead တွေကို အရင်ဦးစားပေး ဆက်သွယ်ပါ',
                      demand_target: 'Marketing ကို တိုးမြှင့်ပြီး Lead ပိုရှာပါ',
                      appointments_target: 'Pending lead တွေကို ဖုန်းဆက်ပြီး Appointment ချိန်းပါ',
                    }[alert.type];
                    const formatShort = (val: number) => {
                      if (!isRevenue) return val.toLocaleString();
                      if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M Ks`;
                      if (val >= 1_000) return `${(val / 1_000).toFixed(0)}K Ks`;
                      return `${val.toLocaleString()} Ks`;
                    };

                    return (
                      <div key={alert.type} className="rounded-lg border border-red-500/15 bg-card/45 p-3 space-y-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-bold uppercase text-muted-foreground font-heading">{metricLabel}</p>
                          <span className="text-[10px] font-semibold text-red-600 dark:text-red-400">
                            {achievedPct}% done
                          </span>
                        </div>
                        <div>
                          <span className="text-lg font-bold font-mono text-red-600 dark:text-red-400">
                            {formatShort(actualVal)}
                          </span>
                          <span className="ml-1 text-[11px] text-muted-foreground font-mono">
                            / {formatShort(targetVal)}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
                            <div
                              className="absolute top-0 bottom-0 w-0.5 bg-amber-400 z-10 rounded-full"
                              style={{ left: `${Math.min(expectedPct, 99)}%` }}
                            />
                            <div
                              className="h-full bg-linear-to-r from-red-600 to-red-400 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(achievedPct, 100)}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[10px] font-semibold">
                            <span className="text-amber-500">Today should be {formatShort(Math.round(expectedVal))}</span>
                            <span className="text-muted-foreground">{formatShort(Math.round(remaining))} left</span>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5 border-t border-red-500/10 pt-2">
                          <ArrowRight className="w-3 h-3 shrink-0 mt-0.5 text-red-500" />
                          <p className="text-[11px] text-red-600 dark:text-red-400 leading-relaxed font-medium">
                            {actionLabel}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* AI Action Recommendations — only shown when there are active alerts */}
      {!isLoading && stats?.alerts && stats.alerts.length > 0 && (
      <Card className="glass-card border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-violet-500/10">
              <Lightbulb className="h-4.5 w-4.5 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold text-foreground font-heading">
                AI အကြံပြုချက်များ
              </CardTitle>
              <CardDescription className="text-xs text-muted-foreground">
                Marketing · Sales · Appointment
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {recsLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full bg-muted rounded-lg" />
              ))}
            </div>
          ) : (recsData?.recommendations?.length ?? 0) === 0 ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-xs gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              အရေးပေါ် ဆောင်ရွက်ရန် မရှိပါ — လုပ်ငန်းလည်ပတ်မှု ကောင်းနေသည်။
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {recsData!.recommendations.map((rec, i) => {
                const areaConfig = {
                  marketing: { icon: Megaphone, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20', label: 'Marketing' },
                  sales: { icon: Zap, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', label: 'Sales' },
                  appointments: { icon: CalendarCheck, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', label: 'Appointments' },
                  general: { icon: UserCheck, color: 'text-slate-600 dark:text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20', label: 'General' },
                };
                const severityBadge = {
                  urgent: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
                  warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
                  info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
                };
                const severityLabel = {
                  urgent: 'အရေးပေါ်',
                  warning: 'သတိပြု',
                  info: 'သတင်းအချက်',
                };
                const cfg = areaConfig[rec.area] ?? areaConfig.general;
                const Icon = cfg.icon;
                return (
                  <div
                    key={i}
                    className={`p-3.5 rounded-lg border ${cfg.border} bg-card/40 space-y-2.5 hover:bg-card/60 transition-colors duration-200`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1.5 rounded-md ${cfg.bg}`}>
                          <Icon className={`w-3.5 h-3.5 ${cfg.color}`} />
                        </div>
                        <span className={`text-[10px] font-bold uppercase tracking-wider ${cfg.color} font-heading`}>
                          {cfg.label}
                        </span>
                      </div>
                      <Badge className={`text-[9px] font-bold border px-1.5 py-0 ${severityBadge[rec.severity]}`}>
                        {severityLabel[rec.severity]}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground leading-snug mb-1">{rec.title}</p>
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{rec.insight}</p>
                    </div>
                    <div className={`text-[11px] font-medium ${cfg.color} flex items-start gap-1.5 pt-1 border-t ${cfg.border}`}>
                      <ArrowRight className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{rec.action}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Admin extra cards */}
      {isAdmin && heroCards.length > 4 && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {heroCards.slice(4).map((stat, i) => (
            <Card
              key={i}
              className="glass-card glass-card-hover border-border/85 shadow-sm cursor-pointer"
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-xs font-semibold uppercase  text-muted-foreground font-heading">{stat.title}</CardTitle>
                <div className={`p-2 rounded-lg ${stat.bg}`}>
                  <stat.icon className={`h-4.5 w-4.5 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20 bg-muted" />
                ) : (
                  <div className="text-2xl font-bold text-foreground font-mono ">
                    {typeof stat.value === 'number' ? stat.value.toLocaleString() : 'N/A'}
                    {typeof stat.value === 'number' && stat.suffix && (
                      <span className="text-xs font-sans text-muted-foreground ml-0.5">{stat.suffix}</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Founder Analytics */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-6">

        {/* Financial Trend */}
        <Card className="glass-card md:col-span-4 border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Financial Trend
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Revenue, expense, and profit/loss across the selected {period}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-64 w-full bg-card/60 rounded-lg" />
            ) : (
              <FinancialTrendChart data={stats?.financialTrend} />
            )}
          </CardContent>
        </Card>

        {/* Sales Funnel */}
        <Card className="glass-card md:col-span-2 border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <Activity className="w-5 h-5 text-cyan-600 dark:text-cyan-400" />
              Sales Funnel
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Lead to appointment to closed deal conversion
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full bg-card/60 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {[
                  { label: 'Leads', value: stats?.salesFunnel.leads ?? 0, color: 'bg-blue-500' },
                  { label: 'Appointments', value: stats?.salesFunnel.appointments ?? 0, color: 'bg-cyan-500' },
                  { label: 'Closed Deals', value: stats?.salesFunnel.closedDeals ?? 0, color: 'bg-emerald-500' },
                ].map((stage) => {
                  const maxValue = Math.max(stats?.salesFunnel.leads ?? 0, 1);
                  const width = Math.max((stage.value / maxValue) * 100, stage.value > 0 ? 8 : 2);
                  return (
                    <div key={stage.label} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground">{stage.label}</span>
                        <span className="text-sm font-bold font-mono text-foreground">{stage.value.toLocaleString()}</span>
                      </div>
                      <div className="h-2 rounded-full bg-muted overflow-hidden">
                        <div className={`h-full rounded-full ${stage.color}`} style={{ width: `${width}%` }} />
                      </div>
                    </div>
                  );
                })}
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="rounded-lg border border-border/70 bg-card/45 p-3">
                    <p className="text-[10px] uppercase text-muted-foreground font-semibold">Lead to Appt</p>
                    <p className="mt-1 text-lg font-bold font-mono text-cyan-600 dark:text-cyan-400">
                      {stats?.salesFunnel.appointmentConversionRate !== null && stats?.salesFunnel.appointmentConversionRate !== undefined
                        ? `${stats.salesFunnel.appointmentConversionRate.toFixed(1)}%`
                        : 'N/A'}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-card/45 p-3">
                    <p className="text-[10px] uppercase text-muted-foreground font-semibold">Appt to Close</p>
                    <p className="mt-1 text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                      {stats?.salesFunnel.closeConversionRate !== null && stats?.salesFunnel.closeConversionRate !== undefined
                        ? `${stats.salesFunnel.closeConversionRate.toFixed(1)}%`
                        : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Services by Revenue */}
        <Card className="glass-card md:col-span-3 border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <Banknote className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Top Services by Revenue
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Services contributing the most revenue in this {period}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3.5">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-card/60 rounded-lg" />
                ))}
              </div>
            ) : stats?.topProducts && stats.topProducts.length > 0 ? (
              <div className="space-y-3.5">
                {stats.topProducts.map((product, i) => {
                  const maxRevenue = Math.max(stats.topProducts[0].revenue, 1);
                  const barWidth = Math.max((product.revenue / maxRevenue) * 100, product.revenue > 0 ? 8 : 2);
                  return (
                    <div key={i} className="space-y-1.5 cursor-pointer group">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {product.product}
                        </span>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono shrink-0">
                          <span>{product.revenue.toLocaleString()} Ks</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-card/65 border border-border/60 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-linear-to-r from-emerald-600 to-emerald-400 transition-all duration-500 "
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground font-mono">
                        {product.count} records · {product.totalQty.toLocaleString()} qty
                      </p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10">
                <Banknote className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground font-semibold">No service revenue tracked yet</p>
                <p className="text-[10px] text-slate-600 mt-1 max-w-50 mx-auto leading-relaxed">
                  Service revenue appears when reports include service amounts
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Business Risks */}
        <Card className="glass-card md:col-span-3 border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <Lightbulb className="w-5 h-5 text-amber-600 dark:text-amber-400" />
              Business Risks
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Compact risk signals that can affect revenue conversion
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full bg-card/60 rounded-lg" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {[
                  {
                    label: 'Overdue Follow-ups',
                    value: stats?.risks.overdueFollowUps ?? 0,
                    tone: (stats?.risks.overdueFollowUps ?? 0) > 0 ? 'red' : 'emerald',
                    note: 'Lead leakage risk',
                  },
                  {
                    label: 'High-priority Leads',
                    value: stats?.risks.highPriorityLeads ?? 0,
                    tone: (stats?.risks.highPriorityLeads ?? 0) > 0 ? 'amber' : 'emerald',
                    note: 'Close-first pipeline',
                  },
                  {
                    label: 'Missing Phone',
                    value: stats?.risks.missingPhoneLeads ?? 0,
                    tone: (stats?.risks.missingPhoneLeads ?? 0) > 0 ? 'red' : 'emerald',
                    note: 'Cannot contact',
                  },
                  {
                    label: 'Due Today',
                    value: stats?.risks.dueTodayFollowUps ?? 0,
                    tone: (stats?.risks.dueTodayFollowUps ?? 0) > 0 ? 'blue' : 'emerald',
                    note: 'Today workload',
                  },
                ].map((risk) => {
                  const toneClass = {
                    red: 'border-red-500/20 bg-red-500/5 text-red-600 dark:text-red-400',
                    amber: 'border-amber-500/20 bg-amber-500/5 text-amber-600 dark:text-amber-400',
                    blue: 'border-blue-500/20 bg-blue-500/5 text-blue-600 dark:text-blue-400',
                    emerald: 'border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400',
                  }[risk.tone];

                  return (
                    <div key={risk.label} className={`rounded-lg border p-3.5 ${toneClass}`}>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{risk.label}</p>
                      <p className="mt-2 text-2xl font-bold font-mono">{risk.value.toLocaleString()}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{risk.note}</p>
                    </div>
                  );
                })}
                <div className="col-span-2 rounded-lg border border-border/70 bg-card/45 p-3">
                  <p className="text-xs font-semibold text-foreground">Founder read</p>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">
                    Overdue follow-ups and missing phone numbers are conversion blockers. High-priority leads are the fastest path to near-term revenue.
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Bot Activity moved lower as system context */}
        <Card className="glass-card md:col-span-6 border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Data Ingestion Status
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              System health context for the business data feeding this dashboard
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-16 w-full bg-card/60 rounded-lg" />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
                <div
                  className={`flex items-center gap-3.5 p-4 rounded-lg border transition-colors duration-200 ${
                    stats?.botActive
                      ? 'bg-emerald-500/5 border-emerald-500/20'
                      : 'bg-card/40 border-border/70'
                  }`}
                >
                  <div className="relative flex h-3 w-3 shrink-0">
                    {stats?.botActive ? (
                      <>
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                      </>
                    ) : (
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-slate-500"></span>
                    )}
                  </div>
                  <div>
                    <p className={`text-xs font-semibold tracking-wide ${stats?.botActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                      {stats?.botActive ? 'TELEGRAM BOT ONLINE' : 'BOT DISCONNECTED'}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {stats?.botActive
                        ? `${stats.todayMessages} messages today · ${stats.weekMessages} this week`
                        : 'Configure your bot token in Settings'}
                    </p>
                  </div>
                </div>
                {stats?.recentMessages && stats.recentMessages.length > 0 ? (
                  <div className="space-y-2">
                    {stats.recentMessages.slice(0, 4).map(msg => (
                      <div key={msg.id} className="flex items-center gap-2.5 text-xs py-1.5 hover:bg-muted/40 transition-colors duration-150 rounded px-2">
                        <span className="text-blue-600 dark:text-blue-400 font-semibold shrink-0">
                          {msg.senderName}
                        </span>
                        <span className="text-muted-foreground truncate flex-1 leading-none">{msg.text}</span>
                        <span className="text-slate-600 text-[10px] shrink-0 font-mono">
                          {formatDistanceToNow(new Date(msg.receivedAt), { addSuffix: true })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-6 text-slate-600 text-xs">
                    No recent messages logged
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>}>
      <DashboardPageContent />
    </Suspense>
  );
}
