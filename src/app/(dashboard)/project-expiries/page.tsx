'use client';

import { useEffect, useRef, useState } from 'react';
import { format, differenceInDays } from 'date-fns';
import { useProjectExpiries } from '@/hooks/use-project-expiries';
import { ProjectExpiration } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { DestructiveConfirmDialog } from '@/components/ui/destructive-confirm-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Clock,
  Search,
  ChevronLeft,
  ChevronRight,
  Globe,
  Server,
  AlertTriangle,
  ExternalLink,
  CalendarDays,
  CheckCircle,
  FileSpreadsheet,
  Bot,
  RefreshCw,
  Trash2,
  Edit2,
  Loader2,
} from 'lucide-react';
import { useProjectExpiryRecommendations, useDeleteAllProjectExpiries, useUpdateProjectExpiry } from '@/hooks/use-project-expiries';

export default function ProjectExpiriesPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'expired' | 'expiring_soon' | 'active'>('all');
  const [page, setPage] = useState(1);
  const [insightPage, setInsightPage] = useState(1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Edit state
  const [editingRecord, setEditingRecord] = useState<ProjectExpiration | null>(null);
  const [editDomainExpiry, setEditDomainExpiry] = useState('');
  const [editHostingExpiry, setEditHostingExpiry] = useState('');
  const [editRemark, setEditRemark] = useState('');
  const [editPackageName, setEditPackageName] = useState('');
  const limit = 20;
  const insightPageSize = 5;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useProjectExpiries({
    page,
    limit,
    search: debouncedSearch || undefined,
    filter: filter === 'all' ? undefined : filter,
  });

  const { data: recsData, isLoading: recsLoading, refetch: recsRefetch, isFetching: recsFetching } = useProjectExpiryRecommendations();
  const insightTotal = recsData?.recommendations.length || 0;
  const insightTotalPages = Math.max(1, Math.ceil(insightTotal / insightPageSize));
  const visibleInsights = recsData?.recommendations.slice(
    (insightPage - 1) * insightPageSize,
    insightPage * insightPageSize,
  ) || [];

  useEffect(() => {
    setInsightPage(1);
  }, [insightTotal]);

  const deleteAllMutation = useDeleteAllProjectExpiries();
  const updateMutation = useUpdateProjectExpiry();

  const handleDeleteAll = async () => {
    await deleteAllMutation.mutateAsync();
    setShowDeleteConfirm(false);
  };

  const handleEditClick = (record: ProjectExpiration) => {
    setEditingRecord(record);
    setEditDomainExpiry(record.domainExpireDate ? record.domainExpireDate.slice(0, 10) : '');
    setEditHostingExpiry(record.hostingExpireDate ? record.hostingExpireDate.slice(0, 10) : '');
    setEditRemark(record.remark || '');
    setEditPackageName(record.packageName || '');
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    await updateMutation.mutateAsync({
      id: editingRecord.id,
      domainExpireDate: editDomainExpiry || null,
      hostingExpireDate: editHostingExpiry || null,
      remark: editRemark || null,
      packageName: editPackageName || null,
    });
    setEditingRecord(null);
  };

  // Auto-refresh AI insights once whenever the underlying record count changes
  // (e.g. new data arrives via Telegram). Bounded — fires only on change, not on a timer.
  const prevTotalRef = useRef<number | null>(null);
  useEffect(() => {
    const total = data?.stats?.total;
    if (total === undefined) return;
    if (prevTotalRef.current !== null && total !== prevTotalRef.current) {
      recsRefetch();
    }
    prevTotalRef.current = total;
  }, [data?.stats?.total, recsRefetch]);

  const stats = data?.stats || { total: 0, expired: 0, expiringSoon: 0, active: 0 };
  const records = data?.records || [];

  // Helper to determine status style of an expiration date
  const getExpiryDetails = (dateStr: string | null) => {
    if (!dateStr) {
      return {
        label: 'None',
        className: 'bg-muted/40 text-muted-foreground border border-border/50',
        textClass: 'text-slate-500',
        urgency: 'none',
        daysLeft: null,
      };
    }

    const date = new Date(dateStr);
    const now = new Date();
    const days = differenceInDays(date, now);

    if (days < 0) {
      return {
        label: `Expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`,
        className: 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20',
        textClass: 'text-red-600 dark:text-red-400 font-medium',
        urgency: 'expired',
        daysLeft: days,
      };
    } else if (days <= 15) {
      return {
        label: `Expires in ${days} day${days === 1 ? '' : 's'}`,
        className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 font-medium animate-pulse',
        textClass: 'text-orange-600 dark:text-orange-400 font-semibold',
        urgency: 'urgent',
        daysLeft: days,
      };
    } else if (days <= 30) {
      return {
        label: `Expires in ${days} day${days === 1 ? '' : 's'}`,
        className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20',
        textClass: 'text-amber-600 dark:text-amber-400',
        urgency: 'warning',
        daysLeft: days,
      };
    } else {
      return {
        label: `Expires in ${days} day${days === 1 ? '' : 's'}`,
        className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20',
        textClass: 'text-emerald-600 dark:text-emerald-400',
        urgency: 'safe',
        daysLeft: days,
      };
    }
  };

  // Find urgent records to show in the alerts box (either expired or expiring in <= 15 days)
  const urgentRecords = records.filter(r => {
    const dDetails = getExpiryDetails(r.domainExpireDate);
    const hDetails = getExpiryDetails(r.hostingExpireDate);
    return (
      dDetails.urgency === 'expired' ||
      dDetails.urgency === 'urgent' ||
      hDetails.urgency === 'expired' ||
      hDetails.urgency === 'urgent'
    );
  }).slice(0, 5); // limit to top 5 alerts to keep it clean



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold  text-foreground font-heading">
            Project Expiries
          </h1>
          <p className="text-muted-foreground text-sm">
            Track and manage domain names, hosting servers, and active website subscription packages.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          disabled={!records.length || deleteAllMutation.isPending}
          className="bg-red-950/20 border-red-900/50 text-red-700 dark:text-red-300 hover:bg-red-900/40 hover:text-red-800 dark:hover:text-red-200 dark:text-red-800 shrink-0 cursor-pointer"
        >
          <Trash2 className="w-4 h-4 mr-1.5" />
          Delete All
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="glass-card glass-card-hover border-border/70 shadow-sm cursor-pointer">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase  text-muted-foreground font-heading">Total Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-muted" />
            ) : (
              <div className="text-2xl font-bold text-foreground font-mono ">{stats.total}</div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card glass-card-hover border-border/70 shadow-sm border-l-4 border-l-red-500/50 cursor-pointer">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase  text-red-600 dark:text-red-400 flex items-center gap-1.5 font-heading">
              <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400" /> Expired
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-muted" />
            ) : (
              <div className="text-2xl font-bold text-red-600 dark:text-red-400 font-mono ">{stats.expired}</div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card glass-card-hover border-border/70 shadow-sm border-l-4 border-l-orange-500/50 cursor-pointer">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase  text-orange-600 dark:text-orange-400 flex items-center gap-1.5 font-heading">
              <Clock className="w-4 h-4 text-orange-600 dark:text-orange-400" /> Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-muted" />
            ) : (
              <div className="text-2xl font-bold text-orange-600 dark:text-orange-400 font-mono ">{stats.expiringSoon}</div>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card glass-card-hover border-border/70 shadow-sm border-l-4 border-l-emerald-500/50 cursor-pointer">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase  text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 font-heading">
              <CheckCircle className="w-4 h-4 text-emerald-600 dark:text-emerald-400" /> Active & Safe
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-muted" />
            ) : (
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 font-mono ">{stats.active}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Insights Card */}
      <Card className="glass-card border-border/70 shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
                <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
                AI Renewal Insights
              </CardTitle>
              <CardDescription className="text-muted-foreground text-xs">
                Gemini AI-powered renewal priority recommendations
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recsRefetch()}
              disabled={recsFetching}
              className="bg-muted/40 border-border text-foreground hover:bg-card/40 shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${recsFetching ? 'animate-spin' : ''}`} />
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
                  key={`${rec.projectName}-${idx}`}
                  className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border/60 hover:border-border hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <div className="p-2 rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400 shrink-0 mt-0.5 animate-pulse">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-foreground/85">{rec.projectName}</p>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{rec.insight}</p>
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
              <p className="text-xs font-semibold text-slate-500">No urgent renewal actions</p>
              <p className="text-[10px] text-slate-600 mt-1">All projects are within safe expiry range</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Urgent Warning Alerts Box */}
      {!isLoading && urgentRecords.length > 0 && (
        <Card className="bg-red-950/10 border border-red-900/30 shadow-sm overflow-hidden">
          <div className="bg-red-500/5 px-5 py-3.5 border-b border-red-900/30 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 animate-bounce shrink-0" />
            <h2 className="text-xs font-bold text-red-700 dark:text-red-300 uppercase  font-mono">
              Urgent Renewals Required
            </h2>
          </div>
          <CardContent className="p-0">
            <div className="divide-y divide-red-950/20">
              {urgentRecords.map(record => {
                const domDetails = getExpiryDetails(record.domainExpireDate);
                const hostDetails = getExpiryDetails(record.hostingExpireDate);
                const isDomUrgent = domDetails.urgency === 'expired' || domDetails.urgency === 'urgent';
                const isHostUrgent = hostDetails.urgency === 'expired' || hostDetails.urgency === 'urgent';

                return (
                  <div key={record.id} className="p-4.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-red-950/20 transition-colors">
                    <div>
                      <span className="font-semibold text-foreground text-sm block">
                        {record.projectName}
                      </span>
                      {record.url && (
                        <a
                          href={record.url.startsWith('http') ? record.url : `https://${record.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 dark:text-blue-700 inline-flex items-center gap-1 mt-0.5 hover:underline cursor-pointer"
                        >
                          {record.url} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isDomUrgent && (
                        <div className="flex items-center gap-1.5 bg-red-900/20 border border-red-800/30 rounded-lg px-2.5 py-1">
                          <Globe className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                          <span className="text-[11px] text-red-700 dark:text-red-300 font-medium font-mono">Domain: {domDetails.label}</span>
                        </div>
                      )}
                      {isHostUrgent && (
                        <div className="flex items-center gap-1.5 bg-red-900/20 border border-red-800/30 rounded-lg px-2.5 py-1">
                          <Server className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                          <span className="text-[11px] text-red-700 dark:text-red-300 font-medium font-mono">Hosting: {hostDetails.label}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Table Card */}
      <Card className="glass-card border-border/70 shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div>
              <CardTitle className="text-foreground font-heading text-lg">Website & Domain Listing</CardTitle>
              <CardDescription className="text-muted-foreground text-xs">
                Search and filter domains, servers, and expiration dates.
              </CardDescription>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  placeholder="Search project, URL, hosts..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="pl-9 bg-muted/40 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-blue-500 w-full sm:w-64 rounded-lg h-10 transition-all duration-200"
                />
              </div>

              <div>
                <Select
                  value={filter}
                  onValueChange={(val) => {
                    setFilter(val as 'all' | 'expired' | 'expiring_soon' | 'active');
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="bg-muted/40 border-border text-foreground min-w-40 rounded-lg h-10">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent className="bg-card border-border text-foreground rounded-lg">
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="expired">Expired Expiries</SelectItem>
                    <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
                    <SelectItem value="active">Active & Safe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <div className="min-w-250">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 border-b border-border px-6 py-4.5 text-xs font-semibold uppercase  text-slate-500 bg-muted/40">
                <div className="col-span-2">Project Name</div>
                <div className="col-span-2">Website URL</div>
                <div className="col-span-3">Domain Expiry</div>
                <div className="col-span-3">Hosting Expiry</div>
                <div className="col-span-2">Package & Remarks</div>
              </div>

              {/* Table Body */}
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-12 gap-4 border-b border-border/70 px-6 py-5">
                    <Skeleton className="col-span-2 h-5 bg-muted" />
                    <Skeleton className="col-span-2 h-5 bg-muted" />
                    <Skeleton className="col-span-3 h-5 bg-muted" />
                    <Skeleton className="col-span-3 h-5 bg-muted" />
                    <Skeleton className="col-span-2 h-5 bg-muted" />
                  </div>
                ))
              ) : records.length ? (
                records.map((record) => {
                  const domDetails = getExpiryDetails(record.domainExpireDate);
                  const hostDetails = getExpiryDetails(record.hostingExpireDate);

                  return (
                    <div
                      key={record.id}
                      className="grid grid-cols-12 gap-4 border-b border-border px-6 py-5 items-center hover:bg-card/20 transition-all duration-200 last:border-0"
                    >
                      {/* Project Name */}
                      <div className="col-span-2 min-w-0">
                        <span className="text-xs font-bold text-foreground block truncate" title={record.projectName}>
                          {record.projectName}
                        </span>
                        <span className="text-[10px] text-slate-500 block mt-1 font-mono">
                          Added: {format(new Date(record.createdAt), 'yyyy-MM-dd')}
                        </span>
                      </div>

                      {/* Website URL */}
                      <div className="col-span-2 min-w-0">
                        {record.url ? (
                          <a
                            href={record.url.startsWith('http') ? record.url : `https://${record.url}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 dark:text-blue-700 font-semibold inline-flex items-center gap-1.5 hover:underline truncate w-full cursor-pointer"
                          >
                            <Globe className="w-3.5 h-3.5 shrink-0 text-blue-600 dark:text-blue-400/80" />
                            <span className="truncate">{record.url}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-[11px] text-slate-600 italic">No URL</span>
                        )}
                      </div>

                      {/* Domain Expiry Details */}
                      <div className="col-span-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${domDetails.className}`}>
                            {domDetails.label}
                          </span>
                        </div>
                        {record.domainExpireDate && (
                          <div className="text-xs text-foreground font-semibold flex items-center gap-1 font-mono">
                            <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
                            <span>{format(new Date(record.domainExpireDate), 'yyyy-MM-dd')}</span>
                          </div>
                        )}
                        {record.domainProvider && (
                          <div className="text-[10px] text-slate-500 font-medium">
                            Provider: <span className="text-muted-foreground font-mono">{record.domainProvider}</span>
                          </div>
                        )}
                      </div>

                      {/* Hosting Expiry Details */}
                      <div className="col-span-3 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${hostDetails.className}`}>
                            {hostDetails.label}
                          </span>
                        </div>
                        {record.hostingExpireDate && (
                          <div className="text-xs text-foreground font-semibold flex items-center gap-1 font-mono">
                            <CalendarDays className="w-3.5 h-3.5 text-slate-500" />
                            <span>{format(new Date(record.hostingExpireDate), 'yyyy-MM-dd')}</span>
                          </div>
                        )}
                        {(record.hostingProvider || record.hostingRemark) && (
                          <div className="text-[10px] text-slate-500 space-y-0.5">
                            {record.hostingProvider && (
                              <div>Provider: <span className="text-muted-foreground font-mono">{record.hostingProvider}</span></div>
                            )}
                            {record.hostingRemark && (
                              <div className="italic truncate max-w-50" title={record.hostingRemark}>
                                Remark: <span className="text-muted-foreground">{record.hostingRemark}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Package & Remarks */}
                      <div className="col-span-2 min-w-0 space-y-1.5 flex items-start justify-between gap-2">
                        <div className="flex-1 space-y-1.5 min-w-0">
                          {record.packageName ? (
                            <Badge variant="outline" className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 text-[10px] truncate max-w-full font-medium">
                              Pkg: {record.packageName}
                            </Badge>
                          ) : (
                            <span className="text-[10px] text-slate-600 block italic">No Package</span>
                          )}
                          {record.remark ? (
                            <p className="text-xs text-muted-foreground truncate w-full leading-normal" title={record.remark}>
                              {record.remark}
                            </p>
                          ) : (
                            <span className="text-[10px] text-slate-600 block italic">No remarks</span>
                          )}
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
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                  <FileSpreadsheet className="mb-4 h-12 w-12 text-slate-600" />
                  <h3 className="text-base font-semibold text-foreground/85">No project expiries found</h3>
                  <p className="mt-1 max-w-sm text-xs text-muted-foreground leading-relaxed">
                    Upload your Expiry Check Excel sheet via Telegram to populate this dashboard.
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>

        {/* Pagination Footer */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-border bg-card/20 px-6 py-4 rounded-b-xl ">
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
      </Card>

      {/* Edit Project Expiry Dialog */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-card border border-border w-full max-w-lg rounded-lg overflow-hidden shadow-lg animate-in zoom-in-95 duration-200 p-6 space-y-4 text-foreground backdrop-blur-xl">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground font-heading">Edit Project Expiry</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{editingRecord.projectName}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditingRecord(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
                ✕
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase  text-muted-foreground">Domain Expiry Date</label>
                <input
                  type="date"
                  value={editDomainExpiry}
                  onChange={e => setEditDomainExpiry(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono transition-all duration-200"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase  text-muted-foreground">Hosting Expiry Date</label>
                <input
                  type="date"
                  value={editHostingExpiry}
                  onChange={e => setEditHostingExpiry(e.target.value)}
                  className="w-full bg-muted/50 border border-border rounded-lg px-3 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono transition-all duration-200"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase  text-muted-foreground">Package Name</label>
              <input
                type="text"
                value={editPackageName}
                onChange={e => setEditPackageName(e.target.value)}
                placeholder="e.g. Basic, Standard, Premium"
                className="w-full bg-muted/50 border border-border rounded-lg px-3.5 py-2.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground transition-all duration-200"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase  text-muted-foreground">Remark</label>
              <textarea
                value={editRemark}
                onChange={e => setEditRemark(e.target.value)}
                placeholder="Notes about this project..."
                className="w-full h-20 bg-muted/50 border border-border rounded-lg p-3.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground transition-all duration-200"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Button variant="outline" onClick={() => setEditingRecord(null)} className="bg-muted/50 border-border text-foreground hover:bg-card cursor-pointer rounded-lg h-10 px-4">
                Cancel
              </Button>
              <Button onClick={handleSaveEdit} disabled={updateMutation.isPending} className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer rounded-lg h-10 px-4">
                {updateMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteConfirm && (
        <DestructiveConfirmDialog
          title="Delete all project expiries?"
          description={
            <>
              This permanently removes{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                all {stats.total} project record(s)
              </span>
              . This action cannot be undone. Use it only when clearing test data before re-uploading.
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
