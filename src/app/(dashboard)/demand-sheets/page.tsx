'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { DemandRecord } from '@/lib/api';
import {
  useDemandRecords,
  useDemandRecordStats,
  useDemandRecordRecommendations,
  useDeleteAllDemandRecords,
  useUpdateDemandRecord,
} from '@/hooks/use-demand-records';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  FileSpreadsheet,
  TrendingUp,
  Search,
  Send,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  ArrowRight,
  RefreshCw,
  Trash2,
  AlertTriangle,
  Edit2,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';

type UpcomingRecord = {
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
  pipeline: {
    new: number;
    contacted: number;
    quoted: number;
    pending: number;
    closed: number;
  };
  totalQuantitySold: number;
  totalAmountSold: number;
  weeklyActivity: {
    date: string;
    count: number;
  }[];
  upcomingRecords: UpcomingRecord[];
};

function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 15000,
  });
}

function WeeklyChart({ data }: { data?: { date: string; count: number }[] }) {
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
          <div key={day.date} className="flex-1 flex flex-col items-center gap-2 h-full">
            <span
              className={`text-xs font-bold ${day.count > 0 ? 'text-white' : 'text-slate-600'}`}
            >
              {day.count}
            </span>
            <div className="w-full flex-1 flex items-end">
              <div
                className={`w-full rounded-t-md transition-all duration-500 ${
                  isToday
                    ? 'bg-linear-to-t from-emerald-600 to-emerald-400 shadow-lg shadow-emerald-500/30'
                    : day.count > 0
                    ? 'bg-linear-to-t from-indigo-600 to-indigo-400'
                    : 'bg-slate-800/50'
                }`}
                style={{ height: `${day.count === 0 ? '4px' : `${Math.max(heightPct, 12)}%`}` }}
              />
            </div>
            <span
              className={`text-[10px] font-medium ${
                isToday ? 'text-emerald-400' : 'text-slate-500'
              }`}
            >
              {dayLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  quoted: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  pending: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  closed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  unknown: 'bg-slate-800 text-slate-400 border-slate-700',
};

const categoryColors: Record<string, string> = {
  sales: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  inquiry: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  follow_up: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  general: 'bg-slate-500/10 text-slate-400 border-slate-700',
};

const statusLabels: Record<string, string> = {
  all: 'All Statuses',
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  pending: 'Pending',
  closed: 'Closed',
};

const categoryLabels: Record<string, string> = {
  all: 'All Categories',
  sales: 'Sales',
  inquiry: 'Inquiry',
  follow_up: 'Follow-up',
  general: 'General',
};

export default function DemandSheetsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'records' | 'services'>('dashboard');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DemandRecord | null>(null);
  const [editStatus, setEditStatus] = useState<string>('new');
  const [editNote, setEditNote] = useState<string>('');
  const limit = 20;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: stats, isLoading: statsLoading } = useDashboardStats();
  const { data: demandStats, isLoading: demandStatsLoading } = useDemandRecordStats();
  const {
    data: recsData,
    isLoading: recsLoading,
    refetch: recsRefetch,
    isFetching: recsFetching,
  } = useDemandRecordRecommendations();

  const deleteAllMutation = useDeleteAllDemandRecords();
  const updateMutation = useUpdateDemandRecord();

  const handleDeleteAll = async () => {
    await deleteAllMutation.mutateAsync();
    setShowDeleteConfirm(false);
  };

  const handleEditClick = (record: DemandRecord) => {
    setEditingRecord(record);
    setEditStatus(record.status);
    setEditNote(record.note || '');
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    await updateMutation.mutateAsync({
      id: editingRecord.id,
      status: editStatus,
      note: editNote,
    });
    setEditingRecord(null);
  };

  const { data, isLoading } = useDemandRecords({
    page,
    limit,
    search: debouncedSearch || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    category: categoryFilter === 'all' ? undefined : categoryFilter,
  });

  // Auto-refresh AI insights once whenever the record count changes
  // (e.g. new data arrives via Telegram). Bounded — fires only on change, not on a timer.
  const prevTotalRef = useRef<number | null>(null);
  useEffect(() => {
    const total = data?.total;
    if (total === undefined) return;
    if (prevTotalRef.current !== null && total !== prevTotalRef.current) {
      recsRefetch();
    }
    prevTotalRef.current = total;
  }, [data?.total, recsRefetch]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">Demand Sheets</h1>
          <p className="text-slate-400">
            Customer inquiries, service packages, revenue tracking, and follow-up activities.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={!data?.total || deleteAllMutation.isPending}
          className="bg-red-950/30 border-red-900/50 text-red-300 hover:bg-red-900/40 hover:text-red-200 shrink-0"
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          Delete All
        </Button>
      </div>

      {/* Tab Switcher */}
      <div className="flex border-b border-slate-800 gap-6">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all relative ${
            activeTab === 'dashboard'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Analytics Dashboard
        </button>
        <button
          onClick={() => setActiveTab('records')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all relative ${
            activeTab === 'records'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          All Records
        </button>
        <button
          onClick={() => setActiveTab('services')}
          className={`pb-3 text-sm font-semibold border-b-2 transition-all relative ${
            activeTab === 'services'
              ? 'border-indigo-500 text-indigo-400'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Services Analytics
        </button>
      </div>

      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Dashboard KPI cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card className="bg-slate-900 border-slate-800 shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Total Leads</CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-slate-800" />
                ) : (
                  <div className="text-3xl font-bold text-white">
                    {stats?.pipeline
                      ? stats.pipeline.new +
                        stats.pipeline.contacted +
                        stats.pipeline.quoted +
                        stats.pipeline.pending +
                        stats.pipeline.closed
                      : 0}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800 shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Total Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-slate-800" />
                ) : (
                  <div className="text-3xl font-bold text-emerald-400">
                    {(stats?.totalAmountSold || 0).toLocaleString()}
                    <span className="text-base font-medium text-slate-500 ml-1">Ks</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800 shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Due Today</CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-slate-800" />
                ) : (
                  <div
                    className={`text-3xl font-bold ${
                      stats?.dueTodayFollowUps ? 'text-amber-400' : 'text-white'
                    }`}
                  >
                    {stats?.dueTodayFollowUps || 0}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="bg-slate-900 border-slate-800 shadow-lg">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-400">Customers</CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-slate-800" />
                ) : (
                  <div className="text-3xl font-bold text-white">{stats?.totalCustomers || 0}</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Grid Layout */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left: Top Services & Volume */}
            <div className="space-y-6">
              <Card className="bg-slate-900 border-slate-800 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <Briefcase className="w-5 h-5 text-indigo-400" />
                    🛠️ Top Services
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Best performing services by sales volume
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {demandStatsLoading ? (
                    <div className="space-y-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full bg-slate-800 rounded" />
                      ))}
                    </div>
                  ) : demandStats?.services && demandStats.services.some(s => s.salesCount > 0) ? (
                    <div className="space-y-3.5">
                      {demandStats.services
                        .filter(s => s.salesCount > 0)
                        .slice(0, 5)
                        .map((service, i) => {
                          const maxCount = Math.max(
                            ...demandStats.services.map(s => s.salesCount),
                            1
                          );
                          const barWidth = Math.max((service.salesCount / maxCount) * 100, 4);
                          return (
                            <div key={i} className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-white truncate pr-4">
                                  {service.serviceName}
                                </span>
                                <span className="text-xs text-slate-400 shrink-0">
                                  {service.salesCount} sales
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-slate-800/60 overflow-hidden border border-slate-700/20">
                                <div
                                  className="h-full rounded-full bg-linear-to-r from-indigo-600 to-indigo-400 transition-all duration-500"
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-sm">
                      No service sales recorded yet
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <TrendingUp className="w-5 h-5 text-indigo-400" />
                    📈 Weekly Ingestion Volume
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Records created in the last 7 days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <Skeleton className="h-36 w-full bg-slate-800 rounded-xl" />
                  ) : (
                    <WeeklyChart data={stats?.weeklyActivity} />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: AI Insights & Upcoming Followups */}
            <div className="space-y-6">
              <Card className="bg-slate-900 border-slate-800 shadow-lg">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-white flex items-center gap-2">
                        <Bot className="w-5 h-5 text-indigo-400 animate-pulse" />
                        🤖 AI Lead Insights (Smart Hotlist)
                      </CardTitle>
                      <CardDescription className="text-slate-400">
                        Gemini AI-powered priority recommendations
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => recsRefetch()}
                      disabled={recsFetching}
                      className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 shrink-0"
                    >
                      <RefreshCw
                        className={`w-4 h-4 mr-1.5 ${recsFetching ? 'animate-spin' : ''}`}
                      />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {recsLoading || recsFetching ? (
                    <div className="space-y-3">
                      <Skeleton className="h-12 w-full bg-slate-800 rounded-xl" />
                      <Skeleton className="h-12 w-full bg-slate-800 rounded-xl" />
                      <Skeleton className="h-12 w-full bg-slate-800 rounded-xl" />
                    </div>
                  ) : recsData?.recommendations && recsData.recommendations.length > 0 ? (
                    <div className="space-y-3">
                      {recsData.recommendations.map((rec, idx) => (
                        <div
                          key={idx}
                          className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-800/80 hover:border-slate-700 transition-colors"
                        >
                          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 shrink-0 mt-0.5 animate-pulse">
                            <Bot className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-200">
                              {rec.customerName}
                            </p>
                            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                              {rec.insight}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <Bot className="w-8 h-8 text-slate-800 mx-auto mb-2" />
                      <p className="text-sm font-medium">No actionable hotlist items</p>
                      <p className="text-xs text-slate-650 mt-1">
                        Pending inquiries will trigger AI analysis
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="bg-slate-900 border-slate-800 shadow-lg">
                <CardHeader>
                  <CardTitle className="text-white flex items-center gap-2">
                    <CalendarClock className="w-5 h-5 text-amber-400" />
                    📅 Upcoming Follow-up Calendar
                  </CardTitle>
                  <CardDescription className="text-slate-400">
                    Next scheduled follow-ups
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full bg-slate-800 rounded-xl" />
                      <Skeleton className="h-12 w-full bg-slate-800 rounded-xl" />
                    </div>
                  ) : stats?.upcomingRecords && stats.upcomingRecords.length > 0 ? (
                    <div className="space-y-3">
                      {stats.upcomingRecords.map(record => (
                        <div
                          key={record.id}
                          className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/40 border border-slate-800/80 hover:border-slate-700 transition-colors"
                        >
                          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0 mt-0.5">
                            <ArrowRight className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-semibold text-slate-200 truncate pr-2">
                                {record.customerName || 'Unknown'}
                              </span>
                              <span className="text-[10px] text-amber-500 font-medium shrink-0">
                                {record.followUpDate
                                  ? format(new Date(record.followUpDate), 'MMM d, yyyy')
                                  : 'N/A'}
                              </span>
                            </div>
                            <p className="text-slate-400 truncate">{record.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle2 className="w-8 h-8 text-emerald-500/30 mx-auto mb-2" />
                      <p className="text-sm text-slate-500">No scheduled follow-ups</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'records' && (
        <>
          {/* Filters and Search Bar */}
          <Card className="bg-slate-900 border-slate-800 shadow-lg">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-4">
                <div className="sm:col-span-2 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    placeholder="Search by customer, note or reporter..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
                  />
                </div>

                <div>
                  <Select
                    value={statusFilter}
                    onValueChange={val => {
                      setStatusFilter(val || 'all');
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-300 min-w-32.5">
                      <span>{statusLabels[statusFilter] || 'All Statuses'}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="new">New</SelectItem>
                      <SelectItem value="contacted">Contacted</SelectItem>
                      <SelectItem value="quoted">Quoted</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="closed">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Select
                    value={categoryFilter}
                    onValueChange={val => {
                      setCategoryFilter(val || 'all');
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-300 min-w-37.5">
                      <span>{categoryLabels[categoryFilter] || 'All Categories'}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
                      <SelectItem value="all">All Categories</SelectItem>
                      <SelectItem value="sales">Sales</SelectItem>
                      <SelectItem value="inquiry">Inquiry</SelectItem>
                      <SelectItem value="follow_up">Follow-up</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Report Records Table */}
          <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
            <div className="hidden md:grid grid-cols-12 gap-3 border-b border-slate-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <div className="col-span-1">Date</div>
              <div className="col-span-2">Customer</div>
              <div className="col-span-2">Business</div>
              <div className="col-span-1">Contact</div>
              <div className="col-span-2">Service / Package</div>
              <div className="col-span-2">Follow-up</div>
              <div className="col-span-2">Notes</div>
            </div>

            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 gap-3 border-b border-slate-800/70 px-4 py-4"
                >
                  <Skeleton className="col-span-1 h-5 bg-slate-800" />
                  <Skeleton className="col-span-2 h-5 bg-slate-800" />
                  <Skeleton className="col-span-2 h-5 bg-slate-800" />
                  <Skeleton className="col-span-1 h-5 bg-slate-800" />
                  <Skeleton className="col-span-2 h-5 bg-slate-800" />
                  <Skeleton className="col-span-2 h-5 bg-slate-800" />
                  <Skeleton className="col-span-2 h-5 bg-slate-800" />
                </div>
              ))
            ) : data?.records.length ? (
              data.records.map(record => (
                <div
                  key={record.id}
                  className="grid grid-cols-1 gap-2 border-b border-slate-800/70 px-4 py-4 last:border-0 md:grid-cols-12 md:items-start md:gap-3 hover:bg-slate-900/30 transition-colors"
                >
                  {/* Date Column */}
                  <div className="md:col-span-1 text-sm text-slate-350 font-medium">
                    {format(new Date(record.createdAt), 'yyyy-MM-dd')}
                  </div>

                  {/* Customer Column */}
                  <div className="md:col-span-2 min-w-0">
                    {record.customerId ? (
                      <Link
                        href={`/customers/${record.customerId}`}
                        className="text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors hover:underline block truncate"
                      >
                        {record.customerName || 'Unknown'}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-white truncate block">
                        {record.customerName || 'Unknown'}
                      </span>
                    )}

                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-500">
                      <Send className="h-3 w-3 shrink-0" />
                      <span className="truncate" title={record.sender.displayName}>
                        {record.sender.displayName}
                      </span>
                    </p>
                    <p className="text-[10px] text-slate-650">
                      {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Business Column */}
                  <div className="md:col-span-2 text-sm text-slate-300 truncate">
                    {record.customer?.company ? (
                      <span className="font-medium text-slate-200">{record.customer.company}</span>
                    ) : (
                      <span className="text-slate-600 italic text-xs">No business</span>
                    )}
                  </div>

                  {/* Contact Number Column */}
                  <div className="md:col-span-1 text-sm text-slate-300 truncate font-mono">
                    {record.customer?.phone ? (
                      <span>{record.customer.phone}</span>
                    ) : (
                      <span className="text-slate-650 italic text-xs">No phone</span>
                    )}
                  </div>

                  {/* Service Name & Badges */}
                  <div className="md:col-span-2 min-w-0">
                    <span
                      className="text-sm font-medium text-slate-200 block truncate"
                      title={record.serviceName || 'No Service Specified'}
                    >
                      {record.serviceName || (
                        <span className="text-slate-600 italic text-xs">No Service Specified</span>
                      )}
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      <Badge
                        variant="outline"
                        className={`${
                          statusColors[record.status] || statusColors.unknown
                        } text-[10px] px-1.5 py-0`}
                      >
                        {record.status}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`${
                          categoryColors[record.category] || categoryColors.general
                        } text-[10px] px-1.5 py-0`}
                      >
                        {record.category}
                      </Badge>
                    </div>
                  </div>

                  {/* Follow Up Date */}
                  <div className="md:col-span-2 text-sm text-slate-300">
                    {record.followUpDate ? (
                      <div className="flex flex-col">
                        <span className="text-slate-200 font-medium">
                          {format(new Date(record.followUpDate), 'yyyy-MM-dd')}
                        </span>
                        <span className="text-[10px] text-amber-500/80 mt-0.5">
                          {new Date(record.followUpDate) < new Date() ? 'Overdue' : 'Scheduled'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-600 italic text-xs">No follow-up</span>
                    )}
                  </div>

                  {/* Note / Remarks */}
                  <div className="md:col-span-2 min-w-0 flex items-start gap-2 justify-between">
                    <p
                      className="text-xs leading-5 text-slate-400 line-clamp-3 flex-1"
                      title={record.note}
                    >
                      {record.note}
                    </p>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(record)}
                      className="h-7 w-7 text-slate-400 hover:text-white shrink-0 hover:bg-slate-800 rounded-lg mt-0.5"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-600" />
                <h3 className="text-lg font-medium text-slate-300">No demand sheets yet</h3>
                <p className="mt-1 max-w-sm text-sm text-slate-500">
                  Send demand sheets via Telegram bot or upload files to see data here.
                </p>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between border border-slate-800 bg-slate-900/30 px-4 py-3 rounded-xl">
              <div className="text-xs text-slate-500">
                Showing Page <span className="text-slate-300 font-medium">{page}</span> of{' '}
                <span className="text-slate-300 font-medium">{data.totalPages}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === data.totalPages}
                  onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                  className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'services' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top Services Card */}
          <div className="lg:col-span-2">
            <Card className="bg-slate-900 border-slate-800 shadow-lg">
              <CardHeader className="pb-3 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-indigo-500/10 text-indigo-400">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-white">Top Services</CardTitle>
                    <CardDescription className="text-slate-400">
                      Best performing services by revenue
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {demandStatsLoading ? (
                  <div className="space-y-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="space-y-2">
                        <div className="flex justify-between">
                          <Skeleton className="h-4 w-32 bg-slate-800" />
                          <Skeleton className="h-4 w-12 bg-slate-800" />
                        </div>
                        <Skeleton className="h-2 w-full bg-slate-800" />
                      </div>
                    ))}
                  </div>
                ) : demandStats?.services && demandStats.services.length > 0 ? (
                  <div className="space-y-4">
                    {demandStats.services.map((service, i) => {
                      const maxRevenue = Math.max(...demandStats.services.map(s => s.revenue), 1);
                      const barWidth =
                        service.revenue > 0 ? Math.max((service.revenue / maxRevenue) * 100, 4) : 0;
                      return (
                        <div key={i} className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-white truncate pr-4">
                              {service.serviceName}
                            </span>
                            <div className="flex items-center gap-3 text-xs text-slate-400 shrink-0">
                              <span>{service.salesCount} sales</span>
                            </div>
                          </div>
                          <div className="h-2 rounded-full bg-slate-800/60 overflow-hidden border border-slate-700/20">
                            <div
                              className="h-full rounded-full bg-linear-to-r from-indigo-600 to-indigo-400 transition-all duration-500"
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500">No services tracked yet</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Analytics Summary */}
          <div className="space-y-6">
            <Card className="bg-slate-900 border-slate-800 shadow-lg">
              <CardHeader className="pb-3 border-b border-slate-800">
                <CardTitle className="text-base text-white">Performance Summary</CardTitle>
                <CardDescription className="text-slate-400">Key product analytics</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">Predefined Services:</span>
                    <span className="text-white font-medium">14</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">Active Services:</span>
                    <span className="text-white font-medium">
                      {demandStatsLoading
                        ? '...'
                        : demandStats?.services.filter(s => s.salesCount > 0).length || 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">Best Performing:</span>
                    <span className="text-emerald-400 font-medium truncate max-w-37.5 text-right">
                      {demandStatsLoading
                        ? '...'
                        : demandStats?.services.find(s => s.revenue > 0 || s.salesCount > 0)
                            ?.serviceName || 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">Total Quantity Sold:</span>
                    <span className="text-white font-medium">{stats?.totalQuantitySold || 0}</span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-400">Total Sales Value:</span>
                    <span className="text-white font-medium">
                      {(stats?.totalAmountSold || 0).toLocaleString()} Ks
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Edit Record Dialog */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Edit Demand Record</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate max-w-xs">
                  {editingRecord.customerName || 'Unknown customer'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingRecord(null)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </Button>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pipeline Status</label>
              <Select value={editStatus} onValueChange={val => setEditStatus(val || 'new')}>
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white focus-visible:ring-indigo-500 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="contacted">Contacted</SelectItem>
                  <SelectItem value="quoted">Quoted</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Note */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">Notes / Remarks</label>
              <textarea
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
                placeholder="Enter note or update remarks..."
                className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-500"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setEditingRecord(null)}
                className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                className="bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-50"
              >
                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-md rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 p-6 space-y-4 text-slate-200">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <h3 className="text-lg font-bold text-white">Delete all demand records?</h3>
            </div>
            <p className="text-sm text-slate-400">
              This permanently removes <span className="font-semibold text-red-300">all {data?.total || 0} demand record(s)</span>. Linked customers are kept (only their demand link is cleared). This action cannot be undone — use it to clear test data and re-upload.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteAllMutation.isPending}
                className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDeleteAll}
                disabled={deleteAllMutation.isPending}
                className="bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteAllMutation.isPending && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
                Delete All
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
