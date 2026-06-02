'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { formatDistanceToNow, format } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  Activity,
  Package,
  TrendingUp,
  Bot,
  CheckCircle2,
  XCircle,
  CalendarClock,
  ShoppingCart,
  BarChart3,
  ArrowRight,
  UserCircle,
} from 'lucide-react';

type PipelineData = {
  new: number;
  contacted: number;
  quoted: number;
  pending: number;
  closed: number;
};

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
  pipeline: PipelineData;
  totalQuantitySold: number;
  totalAmountSold: number;
  weeklyActivity: WeeklyActivity[];
  topProducts: TopProduct[];
  dueTodayRecords: DueTodayRecord[];
};

function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 10000,
  });
}

const PIPELINE_STAGES = [
  { key: 'new', label: 'New', color: 'bg-blue-500', textColor: 'text-blue-400', lightBg: 'bg-blue-500/10' },
  { key: 'contacted', label: 'Contacted', color: 'bg-cyan-500', textColor: 'text-cyan-400', lightBg: 'bg-cyan-500/10' },
  { key: 'quoted', label: 'Quoted', color: 'bg-amber-500', textColor: 'text-amber-400', lightBg: 'bg-amber-500/10' },
  { key: 'pending', label: 'Pending', color: 'bg-orange-500', textColor: 'text-orange-400', lightBg: 'bg-orange-500/10' },
  { key: 'closed', label: 'Closed', color: 'bg-emerald-500', textColor: 'text-emerald-400', lightBg: 'bg-emerald-500/10' },
] as const;

function PipelineBar({ pipeline }: { pipeline?: PipelineData }) {
  if (!pipeline) return null;
  const total = Object.values(pipeline).reduce((a, b) => a + b, 0);
  if (total === 0) return (
    <div className="text-center py-6 text-slate-500 text-sm">No records yet</div>
  );

  return (
    <div className="space-y-4">
      {/* Stacked bar */}
      <div className="flex h-8 rounded-xl overflow-hidden gap-0.5">
        {PIPELINE_STAGES.map(({ key, color }) => {
          const value = pipeline[key];
          const pct = (value / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={key}
              className={`${color} transition-all duration-700 ease-out flex items-center justify-center text-xs font-semibold text-white min-w-[24px]`}
              style={{ width: `${pct}%` }}
              title={`${key}: ${value}`}
            >
              {pct > 8 ? value : ''}
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap gap-4">
        {PIPELINE_STAGES.map(({ key, label, color, textColor }) => (
          <div key={key} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${color}`} />
            <span className={`text-xs ${textColor}`}>{label}</span>
            <span className="text-xs font-bold text-white">{pipeline[key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklyChart({ data }: { data?: WeeklyActivity[] }) {
  if (!data || data.length === 0) return null;
  const maxCount = Math.max(...data.map((d) => d.count), 1);
  const today = new Date().toISOString().split('T')[0];

  return (
    <div className="flex items-end gap-3 h-48 px-2">
      {data.map((day) => {
        const heightPct = (day.count / maxCount) * 100;
        const isToday = day.date === today;
        const dayLabel = new Date(day.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' });
        return (
          <div key={day.date} className="flex-1 flex flex-col items-center gap-2 h-full">
            <span className={`text-xs font-bold ${day.count > 0 ? 'text-white' : 'text-slate-600'}`}>
              {day.count}
            </span>
            <div className="w-full flex-1 flex items-end">
              <div
                className={`w-full rounded-t-md transition-all duration-500 ${
                  isToday
                    ? 'bg-gradient-to-t from-emerald-600 to-emerald-400 shadow-lg shadow-emerald-500/30'
                    : day.count > 0
                      ? 'bg-gradient-to-t from-indigo-600 to-indigo-400'
                      : 'bg-slate-800/50'
                }`}
                style={{ height: `${day.count === 0 ? '4px' : `${Math.max(heightPct, 12)}%`}` }}
              />
            </div>
            <span className={`text-[10px] font-medium ${isToday ? 'text-emerald-400' : 'text-slate-500'}`}>
              {dayLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: stats, isLoading } = useDashboardStats();
  const user = session?.user;
  const isAdmin = stats?.isAdmin ?? false;

  const heroCards = [
    {
      title: 'Total Customers',
      value: stats?.totalCustomers ?? 0,
      icon: UserCircle,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
    },
    {
      title: 'Quantity Sold',
      value: stats?.totalQuantitySold ?? 0,
      icon: Package,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
    },
    {
      title: 'Pending Follow-ups',
      value: stats?.pendingDemandRecords ?? 0,
      icon: CalendarClock,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/20',
    },
    {
      title: 'Closed Deals',
      value: stats?.pipeline?.closed ?? 0,
      icon: CheckCircle2,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
    },
  ];

  // Admin gets extra cards
  if (isAdmin) {
    heroCards.push(
      {
        title: 'Account Users',
        value: stats?.adminStats?.totalUsers ?? 0,
        icon: Users,
        color: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
        border: 'border-cyan-500/20',
      },
      {
        title: 'Active Sessions',
        value: stats?.adminStats?.activeSessions ?? 0,
        icon: Activity,
        color: 'text-rose-400',
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/20',
      }
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white mb-1">
          Welcome back, {user?.name}
        </h1>
        <p className="text-slate-400">
          Sales data overview and customer pipeline.
        </p>
      </div>

      {/* Hero Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {heroCards.slice(0, 4).map((stat, i) => (
          <Card
            key={i}
            className={`bg-slate-900 border-slate-800 shadow-lg hover:${stat.border} transition-all duration-300`}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-400">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <div className="text-3xl font-bold text-white">
                  {stat.value.toLocaleString()}
                </div>
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
              className={`bg-slate-900 border-slate-800 shadow-lg hover:${stat.border} transition-all duration-300`}
            >
              <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                <CardTitle className="text-sm font-medium text-slate-400">
                  {stat.title}
                </CardTitle>
                <div className={`p-2 rounded-xl ${stat.bg}`}>
                  <stat.icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <Skeleton className="h-8 w-20 bg-slate-800" />
                ) : (
                  <div className="text-3xl font-bold text-white">
                    {stat.value.toLocaleString()}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Sales Pipeline */}
      <Card className="bg-slate-900 border-slate-800 shadow-lg">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-400" />
            Sales Pipeline
          </CardTitle>
          <CardDescription className="text-slate-400">
            Customer journey from new lead to closed deal
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-20 w-full bg-slate-800 rounded-xl" />
          ) : (
            <PipelineBar pipeline={stats?.pipeline} />
          )}
        </CardContent>
      </Card>

      {/* Middle Section: Weekly Chart + Due Today */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Weekly Activity Chart */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-400" />
              Weekly Activity
            </CardTitle>
            <CardDescription className="text-slate-400">
              Records created in the last 7 days
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-36 w-full bg-slate-800 rounded-xl" />
            ) : (
              <WeeklyChart data={stats?.weeklyActivity} />
            )}
          </CardContent>
        </Card>

        {/* Due Today Follow-ups */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-amber-400" />
              Due Today
              {stats?.dueTodayFollowUps ? (
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 border-amber-500/20 ml-2">
                  {stats.dueTodayFollowUps}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="text-slate-400">
              Follow-ups that need action today
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-16 w-full bg-slate-800 rounded-xl" />
                ))}
              </div>
            ) : stats?.dueTodayRecords && stats.dueTodayRecords.length > 0 ? (
              <div className="space-y-3">
                {stats.dueTodayRecords.map((record) => (
                  <div
                    key={record.id}
                    className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  >
                    <div className="p-2 rounded-lg bg-amber-500/10 mt-0.5">
                      <ArrowRight className="h-3.5 w-3.5 text-amber-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-medium text-white truncate">
                          {record.customerName || 'Unknown'}
                        </span>
                        {record.quantity && (
                          <Badge variant="secondary" className="bg-indigo-500/10 text-indigo-400 text-xs">
                            {record.quantity} {record.product || 'units'}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 line-clamp-1">{record.note}</p>
                      <p className="text-[10px] text-slate-600 mt-1">by {record.senderName}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <CheckCircle2 className="w-8 h-8 text-emerald-500/50 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No follow-ups due today</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Section: Top Products + Bot Status */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Top Products */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-emerald-400" />
              Top Products
            </CardTitle>
            <CardDescription className="text-slate-400">
              Most demanded products from customer reports
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-slate-800 rounded-lg" />
                ))}
              </div>
            ) : stats?.topProducts && stats.topProducts.length > 0 ? (
              <div className="space-y-3">
                {stats.topProducts.map((product, i) => {
                  const maxCount = stats.topProducts[0].count;
                  const barWidth = Math.max((product.count / maxCount) * 100, 8);
                  return (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white truncate">{product.product}</span>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>{product.count} records</span>
                          <span className="text-emerald-400 font-medium">{product.totalQty} qty</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Package className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No products tracked yet</p>
                <p className="text-xs text-slate-600 mt-1">Product data will appear when extracted from messages</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Bot Status + Recent Activity */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Bot className="w-5 h-5 text-indigo-400" />
              Bot Status & Activity
            </CardTitle>
            <CardDescription className="text-slate-400">
              Connection status and recent messages
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading ? (
              <Skeleton className="h-16 w-full bg-slate-800 rounded-xl" />
            ) : (
              <>
                {/* Connection Status */}
                <div className={`flex items-center gap-3 p-3 rounded-xl ${
                  stats?.botActive
                    ? 'bg-emerald-500/5 border border-emerald-500/20'
                    : 'bg-slate-800/50 border border-slate-700/50'
                }`}>
                  {stats?.botActive ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-6 h-6 text-slate-500 shrink-0" />
                  )}
                  <div>
                    <p className={`text-sm font-medium ${stats?.botActive ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {stats?.botActive ? 'Bot connected' : 'Bot not configured'}
                    </p>
                    <p className="text-xs text-slate-500">
                      {stats?.botActive
                        ? `${stats.todayMessages} messages today · ${stats.weekMessages} this week`
                        : 'Go to Settings to add your bot token'}
                    </p>
                  </div>
                </div>

                {/* Recent messages compact list */}
                {stats?.recentMessages && stats.recentMessages.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Recent Messages</p>
                    {stats.recentMessages.slice(0, 4).map((msg) => (
                      <div key={msg.id} className="flex items-center gap-2 text-xs">
                        <span className="text-indigo-400 font-medium shrink-0">{msg.senderName}</span>
                        <span className="text-slate-500 truncate">{msg.text}</span>
                        <span className="text-slate-600 shrink-0 ml-auto">
                          {formatDistanceToNow(new Date(msg.receivedAt), { addSuffix: true })}
                        </span>
                      </div>
                    ))}
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
