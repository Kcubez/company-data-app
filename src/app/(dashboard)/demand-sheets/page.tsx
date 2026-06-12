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
  PhoneOff,
  Lightbulb,
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

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
  contacted: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20',
  quoted: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  pending: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20',
  closed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  completed: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  unknown: 'bg-muted text-muted-foreground border border-border',
};

const categoryColors: Record<string, string> = {
  sales: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
  inquiry: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20',
  follow_up: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  general: 'bg-slate-500/10 text-muted-foreground border border-border',
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

const priorityColors: Record<string, string> = {
  high: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
  low: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-border',
};

const priorityLabels: Record<string, string> = {
  all: 'All Priority',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export default function DemandSheetsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [insightPage, setInsightPage] = useState(1);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'records' | 'services'>('dashboard');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DemandRecord | null>(null);
  const [editStatus, setEditStatus] = useState<string>('new');
  const [editNote, setEditNote] = useState<string>('');
  const limit = 20;
  const insightPageSize = 5;

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
  const insightTotal = recsData?.recommendations.length || 0;
  const insightTotalPages = Math.max(1, Math.ceil(insightTotal / insightPageSize));
  const visibleInsights = recsData?.recommendations.slice(
    (insightPage - 1) * insightPageSize,
    insightPage * insightPageSize,
  ) || [];

  useEffect(() => {
    setInsightPage(1);
  }, [insightTotal]);

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
    priority: priorityFilter === 'all' ? undefined : priorityFilter,
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold  text-foreground mb-2 font-heading">MOT Demand Analysis</h1>
          <p className="text-muted-foreground text-sm">
            Upload flexible demand sheets, prioritize customers, and turn raw rows into next actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={!data?.total || deleteAllMutation.isPending}
            className="bg-red-950/20 border-red-900/50 text-red-700 dark:text-red-300 hover:bg-red-900/40 hover:text-red-800 dark:hover:text-red-200 dark:text-red-800 shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Delete All
          </Button>
        </div>
      </div>



      {/* Tab Switcher */}
      <div className="flex p-1 bg-card/60 border border-border/80 rounded-lg max-w-sm sm:max-w-md">
        <button
          onClick={() => setActiveTab('dashboard')}
          className={`flex-1 py-2 text-xs font-bold  uppercase rounded-lg transition-all duration-300 cursor-pointer ${
            activeTab === 'dashboard'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Dashboard
        </button>
        <button
          onClick={() => setActiveTab('records')}
          className={`flex-1 py-2 text-xs font-bold  uppercase rounded-lg transition-all duration-300 cursor-pointer ${
            activeTab === 'records'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All Records
        </button>
        <button
          onClick={() => setActiveTab('services')}
          className={`flex-1 py-2 text-xs font-bold  uppercase rounded-lg transition-all duration-300 cursor-pointer ${
            activeTab === 'services'
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Services
        </button>
      </div>

      {activeTab === 'dashboard' && (
        <div className="space-y-6">
          {/* Dashboard KPI cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
            <Card className="glass-card glass-card-hover border-border/70 shadow-sm cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase  text-muted-foreground font-heading">Total Leads</CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-muted" />
                ) : (
                  <div className="text-2xl font-bold text-foreground font-mono ">
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

            <Card className="glass-card glass-card-hover border-border/70 shadow-sm cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase  text-muted-foreground font-heading">Total Revenue</CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-muted" />
                ) : (
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono ">
                    {(stats?.totalAmountSold || 0).toLocaleString()}
                    <span className="text-xs font-sans font-medium text-slate-500 ml-1">Ks</span>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card glass-card-hover border-border/70 shadow-sm cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase  text-muted-foreground font-heading">Due Today</CardTitle>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-16 bg-muted" />
                ) : (
                  <div
                    className={`text-2xl font-bold font-mono  ${
                      stats?.dueTodayFollowUps ? 'text-amber-600 dark:text-amber-400' : 'text-foreground'
                    }`}
                  >
                    {stats?.dueTodayFollowUps || 0}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="glass-card glass-card-hover border-border/70 shadow-sm cursor-pointer">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs font-semibold uppercase  text-muted-foreground font-heading">High Priority</CardTitle>
              </CardHeader>
              <CardContent>
                {demandStatsLoading ? (
                  <Skeleton className="h-8 w-16 bg-muted" />
                ) : (
                  <div className="text-2xl font-bold text-red-600 dark:text-red-400 font-mono ">
                    {demandStats?.priority.high || 0}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {demandStats?.insights && demandStats.insights.length > 0 && (
            <div className="grid gap-4 md:grid-cols-3">
              {demandStats.insights.map((insight) => (
                <Card key={insight.title} className="border-border/70 bg-card/70 shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-sm font-heading">
                      {insight.severity === 'urgent' ? (
                        <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      ) : insight.severity === 'warning' ? (
                        <PhoneOff className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <Lightbulb className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      )}
                      {insight.title}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs leading-relaxed text-muted-foreground">{insight.message}</p>
                    <p className="text-xs font-semibold leading-relaxed text-foreground">{insight.recommendedAction}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Grid Layout */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left: Top Services & Volume */}
            <div className="space-y-6">
              <Card className="glass-card border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
                    <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    Top Services
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs">
                    Best performing services by sales volume
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {demandStatsLoading ? (
                    <div className="space-y-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full bg-muted rounded" />
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
                            <div key={i} className="space-y-1.5 cursor-pointer group">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-semibold text-foreground truncate pr-4">
                                  {service.serviceName}
                                </span>
                                <span className="text-[11px] text-muted-foreground shrink-0 font-mono">
                                  {service.salesCount} sales
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-card/65 overflow-hidden border border-border/60">
                                <div
                                  className="h-full rounded-full bg-linear-to-r from-blue-600 to-blue-400 transition-all duration-500 "
                                  style={{ width: `${barWidth}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      No service sales recorded yet
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-card border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
                    <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
                    Weekly Ingestion Volume
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs">
                    Records created in the last 7 days
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <Skeleton className="h-44 w-full bg-card/60 rounded-lg" />
                  ) : (
                    <WeeklyChart data={stats?.weeklyActivity} />
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right: AI Insights & Upcoming Followups */}
            <div className="space-y-6">
              <Card className="glass-card border-border/70 shadow-sm">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
                        <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
                        AI Lead Insights (Smart Hotlist)
                      </CardTitle>
                      <CardDescription className="text-muted-foreground text-xs">
                        Gemini AI-powered priority recommendations
                      </CardDescription>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => recsRefetch()}
                      disabled={recsFetching}
                      className="bg-card/40 border-border text-foreground hover:bg-card/40 shrink-0 cursor-pointer"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 mr-1.5 ${recsFetching ? 'animate-spin' : ''}`}
                      />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {recsLoading || recsFetching ? (
                    <div className="space-y-3">
                      <Skeleton className="h-12 w-full bg-muted rounded-lg" />
                      <Skeleton className="h-12 w-full bg-muted rounded-lg" />
                      <Skeleton className="h-12 w-full bg-muted rounded-lg" />
                    </div>
                  ) : recsData?.recommendations && recsData.recommendations.length > 0 ? (
                    <div className="space-y-3">
                      {visibleInsights.map((rec, idx) => (
                        <div
                          key={`${rec.customerName}-${idx}`}
                          className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/60 hover:border-border hover:bg-muted/40 transition-colors cursor-pointer"
                        >
                          <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5 animate-pulse">
                            <Bot className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-foreground/85">
                              {rec.customerName}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                              {rec.insight}
                            </p>
                          </div>
                        </div>
                      ))}
                      {insightTotalPages > 1 && (
                        <div className="flex items-center justify-between border-t border-border/70 pt-3">
                          <p className="text-[11px] font-mono text-muted-foreground">
                            Page {insightPage} of {insightTotalPages} · {insightTotal} insights
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={insightPage === 1}
                              onClick={() => setInsightPage((current) => Math.max(1, current - 1))}
                              className="h-8 rounded-lg border-border bg-card px-2.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-50 cursor-pointer"
                            >
                              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                              Prev
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={insightPage === insightTotalPages}
                              onClick={() => setInsightPage((current) => Math.min(insightTotalPages, current + 1))}
                              className="h-8 rounded-lg border-border bg-card px-2.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-50 cursor-pointer"
                            >
                              Next
                              <ChevronRight className="ml-1 h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500">
                      <Bot className="w-8 h-8 text-slate-700 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-500">No actionable hotlist items</p>
                      <p className="text-[10px] text-slate-600 mt-1">
                        Pending inquiries will trigger AI analysis
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-card border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
                    <CalendarClock className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    Upcoming Follow-up Calendar
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs">
                    Next scheduled follow-ups
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {statsLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-12 w-full bg-muted rounded-lg" />
                      <Skeleton className="h-12 w-full bg-muted rounded-lg" />
                    </div>
                  ) : stats?.upcomingRecords && stats.upcomingRecords.length > 0 ? (
                    <div className="space-y-3">
                      {stats.upcomingRecords.map(record => (
                        <div
                          key={record.id}
                          className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/60 hover:border-border hover:bg-muted/40 transition-colors cursor-pointer"
                        >
                          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">
                            <ArrowRight className="w-4 h-4" />
                          </div>
                          <div className="flex-1 min-w-0 text-xs">
                            <div className="flex justify-between items-center mb-1">
                              <span className="font-semibold text-foreground/85 truncate pr-2">
                                {record.customerName || 'Unknown'}
                              </span>
                              <span className="text-[10px] text-amber-600 dark:text-amber-500 font-semibold font-mono shrink-0">
                                {record.followUpDate
                                  ? format(new Date(record.followUpDate), 'MMM d, yyyy')
                                  : 'N/A'}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground truncate">{record.note}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-8">
                      <CheckCircle2 className="w-8 h-8 text-emerald-600 dark:text-emerald-500/30 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground font-semibold">No scheduled follow-ups</p>
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
          <Card className="glass-card border-border/70 shadow-sm">
            <CardContent className="p-4 sm:p-6 space-y-4">
              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-5">
                <div className="sm:col-span-2 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                  <Input
                    placeholder="Search by customer, note or reporter..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="pl-9 bg-muted/40 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-blue-500 rounded-lg h-10 transition-all duration-200"
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
                    <SelectTrigger className="bg-muted/40 border-border text-foreground min-w-32.5 rounded-lg h-10">
                      <span>{statusLabels[statusFilter] || 'All Statuses'}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground rounded-lg">
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
                    value={priorityFilter}
                    onValueChange={val => {
                      setPriorityFilter(val || 'all');
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="bg-muted/40 border-border text-foreground min-w-32.5 rounded-lg h-10">
                      <span>{priorityLabels[priorityFilter] || 'All Priority'}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground rounded-lg">
                      <SelectItem value="all">All Priority</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
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
                    <SelectTrigger className="bg-muted/40 border-border text-foreground min-w-37.5 rounded-lg h-10">
                      <span>{categoryLabels[categoryFilter] || 'All Categories'}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground rounded-lg">
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
          <div className="overflow-hidden rounded-lg border border-border bg-card/20 backdrop-blur-md shadow-sm">
            <div className="hidden md:grid grid-cols-12 gap-3 border-b border-border px-6 py-4.5 text-xs font-semibold uppercase  text-slate-500 bg-muted/40">
              <div className="col-span-1">Date</div>
              <div className="col-span-2">Customer</div>
              <div className="col-span-1">Priority</div>
              <div className="col-span-1">Contact</div>
              <div className="col-span-2">Service / Package</div>
              <div className="col-span-2">Follow-up</div>
              <div className="col-span-3">Action / Notes</div>
            </div>

            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="grid grid-cols-12 gap-3 border-b border-border/70 px-6 py-5"
                >
                  <Skeleton className="col-span-1 h-5 bg-muted" />
                  <Skeleton className="col-span-2 h-5 bg-muted" />
                  <Skeleton className="col-span-1 h-5 bg-muted" />
                  <Skeleton className="col-span-1 h-5 bg-muted" />
                  <Skeleton className="col-span-2 h-5 bg-muted" />
                  <Skeleton className="col-span-2 h-5 bg-muted" />
                  <Skeleton className="col-span-3 h-5 bg-muted" />
                </div>
              ))
            ) : data?.records.length ? (
              data.records.map(record => (
                <div
                  key={record.id}
                  className="grid grid-cols-1 gap-2.5 border-b border-border px-6 py-5 last:border-0 md:grid-cols-12 md:items-start md:gap-3 hover:bg-card/20 transition-all duration-200"
                >
                  {/* Date Column */}
                  <div className="md:col-span-1 text-xs text-muted-foreground font-mono font-medium">
                    {format(new Date(record.createdAt), 'yyyy-MM-dd')}
                  </div>

                  {/* Customer Column */}
                  <div className="md:col-span-2 min-w-0">
                    {record.customerId ? (
                      <Link
                        href={`/customers/${record.customerId}`}
                        className="text-sm font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 dark:text-blue-700 transition-colors hover:underline block truncate cursor-pointer"
                      >
                        {record.customerName || 'Unknown'}
                      </Link>
                    ) : (
                      <span className="text-sm font-medium text-foreground truncate block">
                        {record.customerName || 'Unknown'}
                      </span>
                    )}

                    <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Send className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate" title={record.sender.displayName}>
                        {record.sender.displayName}
                      </span>
                    </p>
                    {record.customer?.company && (
                      <p className="mt-1 truncate text-[11px] font-medium text-muted-foreground">
                        {record.customer.company}
                      </p>
                    )}
                    <p className="text-[10px] text-slate-600 mt-1 font-mono">
                      {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                    </p>
                  </div>

                  {/* Priority Column */}
                  <div className="md:col-span-1 text-xs text-foreground">
                    <Badge
                      variant="outline"
                      className={`${priorityColors[record.priority] || priorityColors.medium} text-[10px] px-2 py-0 font-semibold uppercase`}
                    >
                      {record.priority}
                    </Badge>
                    <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                      {record.potentialScore}/100
                    </p>
                  </div>

                  {/* Contact Number Column */}
                  <div className="md:col-span-1 text-xs text-foreground truncate font-mono">
                    {record.customer?.phone ? (
                      <span>{record.customer.phone}</span>
                    ) : (
                      <span className="text-slate-600 italic text-xs">No phone</span>
                    )}
                  </div>

                  {/* Service Name & Badges */}
                  <div className="md:col-span-2 min-w-0">
                    <span
                      className="text-xs font-semibold text-foreground/85 block truncate"
                      title={record.serviceName || 'No Service Specified'}
                    >
                      {record.serviceName || (
                        <span className="text-slate-600 italic text-xs">No Service Specified</span>
                      )}
                    </span>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge
                        variant="outline"
                        className={`${
                          statusColors[record.status] || statusColors.unknown
                        } text-[10px] px-2 py-0 font-medium`}
                      >
                        {record.status}
                      </Badge>
                      <Badge
                        variant="outline"
                        className={`${
                          categoryColors[record.category] || categoryColors.general
                        } text-[10px] px-2 py-0 font-medium`}
                      >
                        {record.category}
                      </Badge>
                    </div>
                  </div>

                  {/* Follow Up Date */}
                  <div className="md:col-span-2 text-xs text-foreground">
                    {record.followUpDate ? (
                      <div className="flex flex-col">
                        <span className="text-foreground font-semibold font-mono">
                          {format(new Date(record.followUpDate), 'yyyy-MM-dd')}
                        </span>
                        <span className="text-[10px] text-amber-600 dark:text-amber-500/80 mt-0.5 font-medium">
                          {new Date(record.followUpDate) < new Date() ? 'Overdue' : 'Scheduled'}
                        </span>
                      </div>
                    ) : (
                      <span className="text-slate-600 italic text-xs">No follow-up</span>
                    )}
                  </div>

                  {/* Note / Remarks */}
                  <div className="md:col-span-3 min-w-0 flex items-start gap-2 justify-between">
                    <div className="min-w-0 flex-1">
                      <p
                        className="text-[11px] leading-5 text-foreground line-clamp-2 font-medium"
                        title={record.recommendedAction || ''}
                      >
                        {record.recommendedAction || 'Review and decide next action.'}
                      </p>
                      <p
                        className="mt-1 text-[11px] leading-5 text-muted-foreground line-clamp-2"
                        title={record.note}
                      >
                        {record.priorityReason ? `${record.priorityReason}. ` : ''}
                        {record.note}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(record)}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground shrink-0 hover:bg-muted/50 rounded-lg mt-0.5 cursor-pointer transition-colors"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                <FileSpreadsheet className="mb-3 h-10 w-10 text-slate-600" />
                <h3 className="text-base font-semibold text-foreground/85">No demand sheets yet</h3>
                <p className="mt-1 max-w-sm text-xs text-muted-foreground leading-relaxed">
                  Send demand sheets via Telegram bot or upload files to see data here.
                </p>
              </div>
            )}
          </div>

          {/* Pagination Controls */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between border border-border bg-card/20 px-6 py-4 rounded-lg ">
              <div className="text-xs text-muted-foreground font-mono">
                Showing Page <span className="text-foreground font-semibold">{page}</span> of{' '}
                <span className="text-foreground font-semibold">{data.totalPages}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  className="bg-card border-border text-foreground hover:bg-muted/50 disabled:opacity-50 cursor-pointer h-9 px-3.5 rounded-lg"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === data.totalPages}
                  onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
                  className="bg-card border-border text-foreground hover:bg-muted/50 disabled:opacity-50 cursor-pointer h-9 px-3.5 rounded-lg"
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
            <Card className="glass-card border-border/70 shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-foreground font-heading">Top Services</CardTitle>
                    <CardDescription className="text-muted-foreground text-xs">
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
                          <Skeleton className="h-4 w-32 bg-muted" />
                          <Skeleton className="h-4 w-12 bg-muted" />
                        </div>
                        <Skeleton className="h-2 w-full bg-muted" />
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
                        <div key={i} className="space-y-1.5 cursor-pointer group">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-foreground truncate pr-4">
                              {service.serviceName}
                            </span>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 font-mono">
                              <span>{service.salesCount} sales</span>
                            </div>
                          </div>
                          <div className="h-2 rounded-full bg-card/65 overflow-hidden border border-border/60">
                            <div
                              className="h-full rounded-full bg-linear-to-r from-blue-600 to-blue-400 transition-all duration-500 "
                              style={{ width: `${barWidth}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-center py-8 text-slate-500 text-xs">No services tracked yet</div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Quick Analytics Summary */}
          <div className="space-y-6">
            <Card className="glass-card border-border/70 shadow-sm">
              <CardHeader className="pb-3 border-b border-border">
                <CardTitle className="text-base text-foreground font-heading">Performance Summary</CardTitle>
                <CardDescription className="text-muted-foreground text-xs">Key product analytics</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <div className="space-y-3.5">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Predefined Services:</span>
                    <span className="text-foreground font-bold font-mono">14</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Active Services:</span>
                    <span className="text-foreground font-bold font-mono">
                      {demandStatsLoading
                        ? '...'
                        : demandStats?.services.filter(s => s.salesCount > 0).length || 0}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Best Performing:</span>
                    <span className="text-blue-600 dark:text-blue-400 font-bold truncate max-w-37.5 text-right">
                      {demandStatsLoading
                        ? '...'
                        : demandStats?.services.find(s => s.revenue > 0 || s.salesCount > 0)
                            ?.serviceName || 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Total Quantity Sold:</span>
                    <span className="text-foreground font-bold font-mono">{stats?.totalQuantitySold || 0}</span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-muted-foreground">Total Sales Value:</span>
                    <span className="text-emerald-600 dark:text-emerald-400 font-bold font-mono">
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
        <ModalPortal className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
          <div className="bg-card border border-border w-full max-w-lg rounded-lg overflow-hidden shadow-lg animate-in zoom-in-95 duration-200 p-6 space-y-4 text-foreground backdrop-blur-xl">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground font-heading">Edit Demand Record</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">
                  {editingRecord.customerName || 'Unknown customer'}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingRecord(null)}
                className="text-muted-foreground hover:text-foreground cursor-pointer"
              >
                ✕
              </Button>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase  text-muted-foreground">Pipeline Status</label>
              <Select value={editStatus} onValueChange={val => setEditStatus(val || 'new')}>
                <SelectTrigger className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 w-full rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground rounded-lg">
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
              <label className="text-xs font-semibold uppercase  text-muted-foreground">Notes / Remarks</label>
              <textarea
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
                placeholder="Enter note or update remarks..."
                className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground transition-all duration-200"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setEditingRecord(null)}
                className="bg-muted/50 border-border text-foreground hover:bg-card cursor-pointer rounded-lg h-10 px-4"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveEdit}
                disabled={updateMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer rounded-lg h-10 px-4"
              >
                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />}
                Save Changes
              </Button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteConfirm && (
        <DestructiveConfirmDialog
          title="Delete all demand records?"
          description={
            <>
              This permanently removes{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                all {data?.total || 0} demand record(s)
              </span>
              . Linked customers are kept, but their demand links are cleared. This action cannot be undone.
            </>
          }
          isPending={deleteAllMutation.isPending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteAll}
        />
      )}
    </div>
  );
}
