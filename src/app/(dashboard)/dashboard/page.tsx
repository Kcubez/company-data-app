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
  Package,
  TrendingUp,
  Bot,
  CheckCircle2,
  CalendarClock,
  ShoppingCart,
  Banknote,
  ArrowRight,
  Wallet,
  PhoneOff,
} from 'lucide-react';

type WeeklyActivity = {
  date: string;
  count: number;
};

type TopProduct = {
  product: string;
  count: number;
  totalQty: number;
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
  alerts: {
    type: 'revenue_target' | 'demand_target' | 'appointments_target';
    status: 'warning' | 'info';
    message: string;
    actual: number;
    expected: number;
    target: number;
  }[];
};

function useDashboardStats(month: number, year: number) {
  return useQuery({
    queryKey: ['dashboard-stats', month, year],
    queryFn: async (): Promise<DashboardStats> => {
      const res = await fetch(`/api/dashboard/stats?month=${month}&year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 10000,
  });
}

function WeeklyChart({ data }: { data?: WeeklyActivity[] }) {
  if (!data || data.length === 0) return null;
  const maxCount = Math.max(...data.map(d => d.count), 1);
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="flex items-end gap-3 h-48 px-2">
      {data.map(day => {
        const heightPct = (day.count / maxCount) * 100;
        const isToday = day.date === today;
        const dayLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en', {
          weekday: 'short',
        });
        return (
          <div key={day.date} className="flex-1 flex flex-col items-center gap-2 h-full group/bar cursor-pointer">
            <span
              className={`text-xs font-bold font-mono transition-colors duration-200 ${day.count > 0 ? 'text-foreground' : 'text-slate-600'} group-hover/bar:text-blue-600 dark:text-blue-400`}
            >
              {day.count}
            </span>
            <div className="w-full flex-1 flex items-end">
              <div
                className={`w-full rounded-t-md transition-all duration-300 group-hover/bar:opacity-90 group-hover/bar:-translate-y-0.5 ${
                  isToday
                    ? 'bg-linear-to-t from-emerald-600 to-emerald-400  shadow-emerald-500/20 border-t border-emerald-400/20'
                    : day.count > 0
                    ? 'bg-linear-to-t from-blue-600 to-blue-400  shadow-blue-500/10'
                    : 'bg-muted/40'
                }`}
                style={{ height: `${day.count === 0 ? '4px' : `${Math.max(heightPct, 12)}%`}` }}
              />
            </div>
            <span
              className={`text-[10px] font-semibold  font-mono ${
                isToday ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'
              }`}
            >
              {dayLabel.toUpperCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DashboardPageContent() {
  const { data: session } = useSession();
  const now = new Date();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const month = Math.min(
    12,
    Math.max(1, Number(searchParams.get('month') || now.getMonth() + 1)),
  );
  const year = Number(searchParams.get('year') || now.getFullYear());
  const { data: stats, isLoading } = useDashboardStats(month, year);
  const [localMonth, setLocalMonth] = useState(String(month));
  const [localYear, setLocalYear] = useState(String(year));

  useEffect(() => {
    setLocalMonth(String(month));
    setLocalYear(String(year));
  }, [month, year]);

  const user = session?.user;
  const isAdmin = stats?.isAdmin ?? false;
  const years = Array.from({ length: 5 }).map((_, index) => now.getFullYear() - 2 + index);

  const updatePeriod = (next: { month?: number; year?: number }) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('month', String(next.month ?? month));
    params.set('year', String(next.year ?? year));
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const hasMonth = searchParams.has('month');
    const hasYear = searchParams.has('year');

    if (!hasMonth || !hasYear) {
      const storedMonth = localStorage.getItem('dashboard_filter_month');
      const storedYear = localStorage.getItem('dashboard_filter_year');

      if (storedMonth && storedYear) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('month', storedMonth);
        params.set('year', storedYear);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      } else {
        localStorage.setItem('dashboard_filter_month', String(month));
        localStorage.setItem('dashboard_filter_year', String(year));
      }
    } else {
      localStorage.setItem('dashboard_filter_month', String(month));
      localStorage.setItem('dashboard_filter_year', String(year));
    }
  }, [searchParams, pathname, router, month, year]);

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
      title: 'Profit / Loss',
      value: stats?.profitLoss ?? 0,
      suffix: ' Ks',
      icon: Wallet,
      color:
        (stats?.profitLoss ?? 0) >= 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400',
      bg: (stats?.profitLoss ?? 0) >= 0 ? 'bg-emerald-500/10' : 'bg-red-500/10',
      border: (stats?.profitLoss ?? 0) >= 0 ? 'border-emerald-500/20' : 'border-red-500/20',
    },
    {
      title: 'High Potential',
      value: stats?.highPriorityLeads ?? 0,
      suffix: '',
      icon: TrendingUp,
      color: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
    },
    {
      title: 'Missing Phone',
      value: stats?.missingPhoneLeads ?? 0,
      suffix: '',
      icon: PhoneOff,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-500/10',
      border: 'border-red-500/20',
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold  text-foreground mb-1 font-heading">
            MOT Business Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Important revenue, profit/loss, and lead quality signals for {user?.name}.
          </p>
        </div>
        <div className="flex gap-2">
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

      {/* Target Tracking & Deficit Alerts Banner */}
      {!isLoading && stats?.alerts && stats.alerts.length > 0 && (
        <Card className="border-red-500/30 bg-red-500/5 backdrop-blur-md shadow-lg rounded-xl overflow-hidden animate-in fade-in duration-300">
          <CardHeader className="pb-3 border-b border-red-500/10">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-red-500/10 text-red-500">
                <Bot className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <CardTitle className="text-sm font-bold text-red-600 dark:text-red-400 font-heading">
                  AI Sales Operations Warning
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Pacing warning: {Math.round(stats.elapsedRatio * 100)}% of month elapsed. Actual metrics are lagging behind expected pace.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid gap-4 md:grid-cols-3">
              {stats.alerts.map((alert) => {
                const actualVal = alert.actual;
                const expectedVal = Math.round(alert.expected);
                const targetVal = alert.target;
                
                // Calculate percentage towards expected pace and monthly target
                const paceProgress = expectedVal > 0 ? Math.min(100, (actualVal / expectedVal) * 100) : 0;
                const targetProgress = targetVal > 0 ? Math.min(100, (actualVal / targetVal) * 100) : 0;
                const expectedProgressOfMonth = targetVal > 0 ? Math.min(100, (expectedVal / targetVal) * 100) : 0;

                const formatVal = (val: number) => {
                  if (alert.type === 'revenue_target') return `${val.toLocaleString()} Ks`;
                  return val.toLocaleString();
                };

                return (
                  <div key={alert.type} className="p-3 rounded-lg bg-card/40 border border-border/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-heading">
                        {alert.type === 'revenue_target' && 'Sales Revenue'}
                        {alert.type === 'demand_target' && 'Demand Messages'}
                        {alert.type === 'appointments_target' && 'Appointments'}
                      </span>
                      <Badge className="bg-red-500/10 hover:bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 text-[10px] font-bold">
                        -{Math.round(100 - paceProgress)}% Behind Pace
                      </Badge>
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between text-xs font-mono font-bold">
                        <span className="text-red-500">{formatVal(actualVal)}</span>
                        <span className="text-muted-foreground">/ {formatVal(expectedVal)} (exp)</span>
                      </div>
                      <div className="relative h-2 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="absolute top-0 bottom-0 w-0.5 bg-yellow-500 z-10" 
                          style={{ left: `${expectedProgressOfMonth}%` }}
                          title={`Pace line: ${formatVal(expectedVal)}`}
                        />
                        <div 
                          className="h-full bg-linear-to-r from-red-600 to-red-400 rounded-full transition-all duration-500" 
                          style={{ width: `${targetProgress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] text-muted-foreground font-semibold">
                        <span>Actual</span>
                        <span>Target: {formatVal(targetVal)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Hero Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {heroCards.slice(0, 4).map((stat, i) => (
          <Card
            key={i}
            className="glass-card glass-card-hover border-border/70 shadow-sm cursor-pointer"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-xs font-semibold uppercase  text-muted-foreground font-heading">{stat.title}</CardTitle>
              <div className={`p-2 rounded-lg ${stat.bg}`}>
                <stat.icon className={`h-4.5 w-4.5 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoading ? (
                <Skeleton className="h-8 w-20 bg-muted" />
              ) : (
                <>
                  <div className="text-2xl font-bold text-foreground font-mono ">
                    {stat.value.toLocaleString()}
                    {stat.suffix && <span className="text-xs font-sans text-muted-foreground ml-0.5">{stat.suffix}</span>}
                  </div>
                  {stat.title === 'Total Revenue' && stats?.targetSalesAmount ? (
                    <div className="space-y-1">
                      <div className="flex justify-between text-[10px] text-muted-foreground font-semibold font-mono">
                        <span>Pace: {Math.round(stats.elapsedRatio * 100)}%</span>
                        <span>Goal: {Math.round((stats.totalAmountSold / stats.targetSalesAmount) * 100)}%</span>
                      </div>
                      <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-emerald-500 rounded-full" 
                          style={{ width: `${Math.min(100, (stats.totalAmountSold / stats.targetSalesAmount) * 100)}%` }}
                        />
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

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
                    {stat.value.toLocaleString()}
                    {stat.suffix && <span className="text-xs font-sans text-muted-foreground ml-0.5">{stat.suffix}</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Bento Grid Layout */}
      <div className="grid gap-6 grid-cols-1 md:grid-cols-6">
        
        {/* Weekly Activity Chart (span 4) */}
        <Card className="glass-card md:col-span-4 border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
              Weekly Activity
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Records created in the last 7 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-44 w-full bg-card/60 rounded-lg" />
            ) : (
              <WeeklyChart data={stats?.weeklyActivity} />
            )}
          </CardContent>
        </Card>

        {/* Due Today Follow-ups (span 2) */}
        <Card className="glass-card md:col-span-2 border-border/70 shadow-sm flex flex-col">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center justify-between font-heading text-base">
              <span className="flex items-center gap-2">
                <CalendarClock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                Due Today
              </span>
              {stats?.dueTodayFollowUps ? (
                <Badge
                  variant="secondary"
                  className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 text-xs font-mono font-bold"
                >
                  {stats.dueTodayFollowUps}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Follow-ups that need action today
            </CardDescription>
          </CardHeader>
          <CardContent className="flex-1 overflow-y-auto max-h-56 pr-1">
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full bg-card/60 rounded-lg" />
                ))}
              </div>
            ) : stats?.dueTodayRecords && stats.dueTodayRecords.length > 0 ? (
              <div className="space-y-3">
                {stats.dueTodayRecords.map(record => (
                  <div
                    key={record.id}
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/60 hover:border-border hover:bg-card/20 transition-all duration-200 cursor-pointer group"
                  >
                    <div className="p-2 rounded-lg bg-amber-500/10 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0">
                      <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform duration-200" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {record.customerName || 'Unknown'}
                        </span>
                        {record.quantity && (
                          <Badge
                            variant="secondary"
                            className="bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[9px] border border-blue-500/15 py-0 px-1 font-mono"
                          >
                            {record.quantity} {record.product || 'units'}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{record.note}</p>
                      <p className="text-[9px] text-slate-500 mt-1 font-mono">by {record.senderName}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 flex flex-col justify-center items-center h-full">
                <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-500/40 mb-2 animate-bounce" />
                <p className="text-xs text-muted-foreground font-semibold">No follow-ups due today</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top Products (span 3) */}
        <Card className="glass-card md:col-span-3 border-border/70 shadow-sm">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <ShoppingCart className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              Top Services
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Most demanded services from customer reports
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
                  const maxCount = stats.topProducts[0].count;
                  const barWidth = Math.max((product.count / maxCount) * 100, 8);
                  return (
                    <div key={i} className="space-y-1.5 cursor-pointer group">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-foreground truncate">
                          {product.product}
                        </span>
                        <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-mono">
                          <span>{product.count} records</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-card/65 border border-border/60 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-linear-to-r from-emerald-600 to-emerald-400 transition-all duration-500 "
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-10">
                <Package className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground font-semibold">No products tracked yet</p>
                <p className="text-[10px] text-slate-600 mt-1 max-w-50 mx-auto leading-relaxed">
                  Product data will appear when extracted from messages
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bot Status & Recent Activity (span 3) */}
        <Card className="glass-card md:col-span-3 border-border/70 shadow-sm flex flex-col">
          <CardHeader>
            <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
              <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              Bot Status & Activity
            </CardTitle>
            <CardDescription className="text-muted-foreground text-xs">
              Connection status and recent messages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 flex-1 flex flex-col justify-between">
            {isLoading ? (
              <Skeleton className="h-16 w-full bg-card/60 rounded-lg" />
            ) : (
              <>
                {/* Connection Status */}
                <div
                  className={`flex items-center gap-3.5 p-4 rounded-lg border transition-all duration-300 ${
                    stats?.botActive
                      ? 'bg-emerald-500/5 border-emerald-500/20 glow-emerald'
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
                    <p
                      className={`text-xs font-semibold tracking-wide ${
                        stats?.botActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'
                      }`}
                    >
                      {stats?.botActive ? 'TELEGRAM BOT ONLINE' : 'BOT DISCONNECTED'}
                    </p>
                    <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                      {stats?.botActive
                        ? `${stats.todayMessages} messages today · ${stats.weekMessages} this week`
                        : 'Configure your bot token in Settings'}
                    </p>
                  </div>
                </div>

                {/* Recent messages compact list */}
                {stats?.recentMessages && stats.recentMessages.length > 0 ? (
                  <div className="space-y-2.5 mt-2 flex-1 overflow-y-auto max-h-40 pr-1">
                    <p className="text-[9px] font-bold text-slate-500 uppercase  font-mono">
                      Recent Ingestions
                    </p>
                    <div className="space-y-1.5">
                      {stats.recentMessages.slice(0, 4).map(msg => (
                        <div key={msg.id} className="flex items-center gap-2.5 text-xs py-1 hover:bg-muted/40 transition-colors duration-150 rounded px-1.5 cursor-pointer">
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
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center py-6 text-slate-600 text-xs">
                    No recent messages logged
                  </div>
                )}
              </>
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
