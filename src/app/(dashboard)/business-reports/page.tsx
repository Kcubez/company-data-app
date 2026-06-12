'use client';

import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  useBusinessReports,
  useBusinessReportStats,
  useBusinessReportRecommendations,
  useUpdateBusinessReport,
  useDeleteBusinessReport,
  useDeleteAllBusinessReports,
} from '@/hooks/use-business-reports';
import { BusinessReport } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  BarChart3,
  TrendingUp,
  Target,
  Users,
  DollarSign,
  Phone,
  CalendarCheck,
  Bot,
  RefreshCw,
  Trash2,
  Edit2,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Percent,
  Megaphone,
  ShoppingCart,
} from 'lucide-react';

const CHANNELS = ['All', 'Facebook', 'Google', 'Referral', 'Walk-in', 'Telegram', 'Other'];

const CHANNEL_COLORS: Record<string, string> = {
  Facebook: '#1877F2',
  Google: '#EA4335',
  Referral: '#10B981',
  'Walk-in': '#F59E0B',
  Telegram: '#0088CC',
  Other: '#6B7280',
};

function fmt(n: number | null | undefined, prefix = '') {
  if (n == null) return '—';
  return prefix + n.toLocaleString();
}

function MiniBarChart({
  data,
  maxVal,
  color,
}: {
  data: number[];
  maxVal: number;
  color: string;
}) {
  if (!data.length || maxVal === 0) return null;
  return (
    <div className="flex items-end gap-0.5 h-8">
      {data.map((v, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm min-w-0.75"
          style={{
            height: `${Math.max(4, Math.round((v / maxVal) * 32))}px`,
            background: color,
            opacity: 0.7 + (i / data.length) * 0.3,
          }}
        />
      ))}
    </div>
  );
}

export default function BusinessReportsPage() {
  const [page, setPage] = useState(1);
  const [insightPage, setInsightPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editingRecord, setEditingRecord] = useState<BusinessReport | null>(null);
  const [editForm, setEditForm] = useState<Partial<BusinessReport>>({});
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const limit = 20;
  const insightPageSize = 5;

  const listParams = {
    page,
    limit,
    channel: channelFilter !== 'All' ? channelFilter : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = useBusinessReports(listParams);
  const { data: statsData, isLoading: statsLoading } = useBusinessReportStats({
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });
  const {
    data: recsData,
    isLoading: recsLoading,
    refetch: recsRefetch,
    isFetching: recsFetching,
  } = useBusinessReportRecommendations();

  const updateMutation = useUpdateBusinessReport();
  const deleteMutation = useDeleteBusinessReport();
  const deleteAllMutation = useDeleteAllBusinessReports();
  const insightTotal = recsData?.recommendations.length || 0;
  const insightTotalPages = Math.max(1, Math.ceil(insightTotal / insightPageSize));
  const visibleInsights = recsData?.recommendations.slice(
    (insightPage - 1) * insightPageSize,
    insightPage * insightPageSize,
  ) || [];

  useEffect(() => {
    setInsightPage(1);
  }, [insightTotal]);

  const s = statsData;
  const records = data?.records ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const dailySales = (s?.dailyTrend ?? []).map((d) => d.sales);
  const maxSales = Math.max(...dailySales, 1);

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold  text-foreground flex items-center gap-2">
            <BarChart3 className="h-7 w-7 text-violet-600 dark:text-violet-400" />
            Business Reports
          </h1>
          <p className="text-muted-foreground">
            Marketing activity, appointments &amp; sales performance tracking.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={deleteAllMutation.isPending}
          className="bg-red-950/30 border-red-900/50 text-red-700 dark:text-red-300 hover:bg-red-900/40 hover:text-red-800 dark:hover:text-red-200 dark:text-red-800 shrink-0"
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          Delete All
        </Button>
      </div>

      {/* ─── Delete All Confirm ───────────────────────────────────────── */}
      {showDeleteConfirm && (
        <DestructiveConfirmDialog
          title="Delete all business report records?"
          description={
            <>
              This permanently removes{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                all {total} business report record(s)
              </span>
              . This action cannot be undone. Use it only when clearing test data before re-uploading.
            </>
          }
          isPending={deleteAllMutation.isPending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={async () => {
            await deleteAllMutation.mutateAsync();
            setShowDeleteConfirm(false);
          }}
        />
      )}

      {/* ─── KPI Cards ───────────────────────────────────────────────── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-6">
        {/* Total Sales */}
        <Card className="bg-card border-border shadow-sm border-l-4 border-l-emerald-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <DollarSign className="w-4 h-4" /> Total Sales
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20 bg-muted" /> : (
              <>
                <div className="text-2xl font-bold text-foreground">{s ? `${(s.totalSales / 1000).toFixed(0)}K` : '—'} <span className="text-sm text-muted-foreground">Ks</span></div>
                <p className="text-xs text-muted-foreground mt-1">{s?.totalReports ?? 0} reports</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Ad Spend */}
        <Card className="bg-card border-border shadow-sm border-l-4 border-l-blue-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
              <Megaphone className="w-4 h-4" /> Ad Spend
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-20 bg-muted" /> : (
              <>
                <div className="text-2xl font-bold text-foreground">{s ? `${(s.totalBudget / 1000).toFixed(0)}K` : '—'} <span className="text-sm text-muted-foreground">Ks</span></div>
                <p className="text-xs text-muted-foreground mt-1">{s && s.roi != null ? `ROI ${s.roi > 0 ? '+' : ''}${s.roi}%` : '—'}</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* New Leads */}
        <Card className="bg-card border-border shadow-sm border-l-4 border-l-amber-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
              <Users className="w-4 h-4" /> New Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16 bg-muted" /> : (
              <>
                <div className="text-2xl font-bold text-foreground">{fmt(s?.totalLeads)}</div>
                <p className="text-xs text-muted-foreground mt-1">Closed: {fmt(s?.totalClosed)}</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Conversion */}
        <Card className="bg-card border-border shadow-sm border-l-4 border-l-pink-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-pink-600 dark:text-pink-400 flex items-center gap-1.5">
              <Percent className="w-4 h-4" /> Conversion
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16 bg-muted" /> : (
              <>
                <div className="text-2xl font-bold text-foreground">{s ? `${s.conversionRate}%` : '—'}</div>
                <p className="text-xs text-muted-foreground mt-1">Cost/Lead: {fmt(s?.costPerLead)} Ks</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Appt Show Rate */}
        <Card className="bg-card border-border shadow-sm border-l-4 border-l-teal-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
              <CalendarCheck className="w-4 h-4" /> Show Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16 bg-muted" /> : (
              <>
                <div className="text-2xl font-bold text-foreground">{s ? `${s.apptShowRate}%` : '—'}</div>
                <p className="text-xs text-muted-foreground mt-1">{fmt(s?.totalApptsKept)}/{fmt(s?.totalApptsMade)} kept</p>
              </>
            )}
          </CardContent>
        </Card>

        {/* Calls Made */}
        <Card className="bg-card border-border shadow-sm border-l-4 border-l-violet-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-violet-600 dark:text-violet-400 flex items-center gap-1.5">
              <Phone className="w-4 h-4" /> Calls Made
            </CardTitle>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16 bg-muted" /> : (
              <>
                <div className="text-2xl font-bold text-foreground">{fmt(s?.totalCalls)}</div>
                <p className="text-xs text-muted-foreground mt-1">Demand: {fmt(s?.totalDemand)}</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── Charts Row ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Daily Sales Trend */}
        <Card className="lg:col-span-2 bg-card border-border shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              Daily Sales Trend
            </CardTitle>
            <CardDescription className="text-slate-500 text-xs">
              Total sales per day (recent {(s?.dailyTrend ?? []).length} days)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-20 w-full bg-muted" />
            ) : (s?.dailyTrend ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-1">
                <MiniBarChart data={dailySales} maxVal={maxSales} color="#10B981" />
                <div className="flex justify-between text-[10px] text-slate-600 pt-1">
                  <span>{s?.dailyTrend[0]?.date}</span>
                  <span>{s?.dailyTrend[s.dailyTrend.length - 1]?.date}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Channel Performance */}
        <Card className="glass-card glass-card-hover border-border/70 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              Channel Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {statsLoading ? (
              <Skeleton className="h-40 w-full bg-muted" />
            ) : (s?.channelPerformance ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No channel data yet</p>
            ) : (
              (s?.channelPerformance ?? []).slice(0, 5).map((ch) => {
                const maxChSales = Math.max(...(s?.channelPerformance ?? []).map((c) => c.sales), 1);
                const pct = maxChSales > 0 ? Math.round((ch.sales / maxChSales) * 100) : 0;
                const color = CHANNEL_COLORS[ch.channel] ?? '#6B7280';
                return (
                  <div key={ch.channel} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground/85">{ch.channel}</span>
                      <span className="text-muted-foreground">{(ch.sales / 1000).toFixed(0)}K Ks</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%`, background: color }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── AI Insights ────────────────────────────────────────────── */}
      <Card className="glass-card glass-card-hover border-border/70 shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-foreground flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
                AI Business Insights
              </CardTitle>
              <CardDescription className="text-muted-foreground">
                Gemini AI-powered marketing &amp; sales performance analysis
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recsRefetch()}
              disabled={recsFetching}
              className="bg-card border-border text-foreground hover:bg-muted shrink-0"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${recsFetching ? 'animate-spin' : ''}`} />
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
          ) : !recsData?.recommendations?.length ? (
            <div className="text-center py-8 text-slate-500">
              <Bot className="w-8 h-8 text-slate-800 mx-auto mb-2" />
              <p className="text-sm font-medium">No insights yet</p>
              <p className="text-xs text-muted-foreground mt-1">Upload business reports via Telegram to get AI analysis</p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleInsights.map((rec, i) => (
                <div
                  key={`${rec.title}-${i}`}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border/70 hover:border-border transition-colors"
                >
                  <div className="p-2 rounded-lg bg-violet-500/10 text-violet-600 dark:text-violet-400 shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground/85">{rec.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{rec.insight}</p>
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
          )}
        </CardContent>
      </Card>

      {/* ─── Filters + Table ────────────────────────────────────────── */}
      <Card className="glass-card glass-card-hover border-border/70 shadow-sm">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-foreground text-lg">Records</CardTitle>
              <CardDescription className="text-muted-foreground text-xs">
                {total.toLocaleString()} record{total !== 1 ? 's' : ''} found
              </CardDescription>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={channelFilter}
                onValueChange={(v) => { setChannelFilter(v ?? 'All'); setPage(1); }}
              >
                <SelectTrigger className="h-8 w-36 text-xs bg-muted border-border text-foreground">
                  <SelectValue placeholder="Channel" />
                </SelectTrigger>
                <SelectContent>
                  {CHANNELS.map((c) => (
                    <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="date"
                className="h-8 w-36 text-xs bg-muted border-border text-foreground"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                placeholder="From"
              />
              <Input
                type="date"
                className="h-8 w-36 text-xs bg-muted border-border text-foreground"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                placeholder="To"
              />
              {(dateFrom || dateTo || channelFilter !== 'All') && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => { setDateFrom(''); setDateTo(''); setChannelFilter('All'); setPage(1); }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  {['Date', 'Reporter', 'Channel', 'Budget', 'Calls', 'Appts', 'Leads', 'Sales', 'Closed', 'Pending', 'Conv%', 'Actions'].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? [...Array(5)].map((_, i) => (
                      <tr key={i} className="border-b border-border/70">
                        {[...Array(12)].map((_, j) => (
                          <td key={j} className="px-3 py-2.5">
                            <Skeleton className="h-4 w-16 bg-muted" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : records.length === 0
                  ? (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-slate-500">
                        No records found. Send a business report via Telegram or upload the Excel template.
                      </td>
                    </tr>
                  )
                  : records.map((r) => {
                      const convRate =
                        r.newLeads && r.newLeads > 0 && r.closedDeals != null
                          ? `${Math.round((r.closedDeals / r.newLeads) * 100)}%`
                          : '—';
                      const chColor = CHANNEL_COLORS[r.marketingChannel ?? ''] ?? '#6B7280';
                      return (
                        <tr
                          key={r.id}
                          className="border-b border-border/70 hover:bg-muted/60 transition-colors"
                        >
                          <td className="px-3 py-2.5 whitespace-nowrap font-medium text-foreground/85">
                            {format(new Date(r.reportDate), 'MM/dd/yy')}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-foreground">
                            {r.reporterName ?? r.sender?.displayName ?? '—'}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {r.marketingChannel ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-0"
                                style={{ background: `${chColor}22`, color: chColor }}
                              >
                                {r.marketingChannel}
                              </Badge>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-foreground">
                            {r.marketingBudget != null ? `${r.marketingBudget.toLocaleString()} Ks` : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-foreground">{fmt(r.callsMade)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-foreground">
                            {r.appointmentsKept != null && r.appointmentsMade != null
                              ? `${r.appointmentsKept}/${r.appointmentsMade}`
                              : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-foreground">{fmt(r.newLeads)}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap font-medium text-emerald-600 dark:text-emerald-400">
                            {r.totalSalesAmount != null ? `${r.totalSalesAmount.toLocaleString()} Ks` : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-green-600 dark:text-green-400">{fmt(r.closedDeals)}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className="text-amber-600 dark:text-amber-400">{fmt(r.pendingDeals)}</span>
                          </td>
                          <td className="px-3 py-2.5 text-foreground">{convRate}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                                onClick={() => openEdit(r)}
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </Button>
                              {deleteConfirmId === r.id ? (
                                <div className="flex gap-1">
                                  <Button
                                    size="icon"
                                    className="h-6 w-6 bg-red-600 hover:bg-red-700 text-white"
                                    disabled={deleteMutation.isPending}
                                    onClick={async () => {
                                      await deleteMutation.mutateAsync(r.id);
                                      setDeleteConfirmId(null);
                                    }}
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
                                    className="h-6 w-6 text-muted-foreground"
                                    onClick={() => setDeleteConfirmId(null)}
                                  >
                                    ✕
                                  </Button>
                                </div>
                              ) : (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 dark:text-red-700"
                                  onClick={() => setDeleteConfirmId(r.id)}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 bg-muted border-border text-foreground"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 bg-muted border-border text-foreground"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  <ChevronRight className="h-3.5 w-3.5" />
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
