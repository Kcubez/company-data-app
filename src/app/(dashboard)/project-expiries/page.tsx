'use client';

import { useEffect, useState } from 'react';
import { formatDistanceToNow, format, differenceInDays } from 'date-fns';
import { useProjectExpiries } from '@/hooks/use-project-expiries';
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
  Info,
  CalendarDays,
  CheckCircle,
  FileSpreadsheet,
  Bot,
  RefreshCw,
} from 'lucide-react';
import { useProjectExpiryRecommendations } from '@/hooks/use-project-expiries';

export default function ProjectExpiriesPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'expired' | 'expiring_soon' | 'active'>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

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

  const stats = data?.stats || { total: 0, expired: 0, expiringSoon: 0, active: 0 };
  const records = data?.records || [];

  // Helper to determine status style of an expiration date
  const getExpiryDetails = (dateStr: string | null) => {
    if (!dateStr) {
      return {
        label: 'None',
        className: 'bg-slate-800 text-slate-400 border-slate-700',
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
        className: 'bg-red-500/10 text-red-400 border-red-500/20',
        textClass: 'text-red-400 font-medium',
        urgency: 'expired',
        daysLeft: days,
      };
    } else if (days <= 15) {
      return {
        label: `Expires in ${days} day${days === 1 ? '' : 's'}`,
        className: 'bg-orange-500/10 text-orange-400 border-orange-500/20 font-medium animate-pulse',
        textClass: 'text-orange-400 font-semibold',
        urgency: 'urgent',
        daysLeft: days,
      };
    } else if (days <= 30) {
      return {
        label: `Expires in ${days} day${days === 1 ? '' : 's'}`,
        className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
        textClass: 'text-amber-400',
        urgency: 'warning',
        daysLeft: days,
      };
    } else {
      return {
        label: `Expires in ${days} day${days === 1 ? '' : 's'}`,
        className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        textClass: 'text-slate-300',
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

  const filterLabels = {
    all: 'All Statuses',
    expired: 'Expired Expiries',
    expiring_soon: 'Expiring Soon (30 Days)',
    active: 'Active / Safe',
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Project Expiries
        </h1>
        <p className="text-slate-400">
          Track and manage domain names, hosting servers, and active website subscription packages.
        </p>
      </div>

      {/* AI Insights Card */}
      <Card className="bg-slate-900 border-slate-800 shadow-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400 animate-pulse" />
                🤖 AI Renewal Insights
              </CardTitle>
              <CardDescription className="text-slate-400">
                Gemini AI-powered renewal priority recommendations
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recsRefetch()}
              disabled={recsFetching}
              className="bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800 shrink-0"
            >
              <RefreshCw className={`w-4 h-4 mr-1.5 ${recsFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {recsLoading ? (
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
                  <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400 shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-200">{rec.projectName}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{rec.insight}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <Bot className="w-8 h-8 text-slate-800 mx-auto mb-2" />
              <p className="text-sm font-medium">No urgent renewal actions</p>
              <p className="text-xs text-slate-600 mt-1">All projects are within safe expiry range</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Projects</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-3xl font-bold text-white">{stats.total}</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 shadow-lg border-l-4 border-l-red-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-red-400" /> Expired
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-3xl font-bold text-red-400">{stats.expired}</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 shadow-lg border-l-4 border-l-orange-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-orange-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-orange-400" /> Expiring Soon
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-3xl font-bold text-orange-400">{stats.expiringSoon}</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 shadow-lg border-l-4 border-l-emerald-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-400 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-emerald-400" /> Active & Safe
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-3xl font-bold text-emerald-400">{stats.active}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Urgent Warning Alerts Box */}
      {!isLoading && urgentRecords.length > 0 && (
        <Card className="bg-red-950/20 border-red-900/40 shadow-xl overflow-hidden">
          <div className="bg-red-500/10 px-4 py-3 border-b border-red-900/30 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400 animate-bounce" />
            <h2 className="text-sm font-bold text-red-300 uppercase tracking-wider">
              Urgent Renewals Required
            </h2>
          </div>
          <CardContent className="p-0">
            <div className="divide-y divide-red-950/30">
              {urgentRecords.map(record => {
                const domDetails = getExpiryDetails(record.domainExpireDate);
                const hostDetails = getExpiryDetails(record.hostingExpireDate);
                const isDomUrgent = domDetails.urgency === 'expired' || domDetails.urgency === 'urgent';
                const isHostUrgent = hostDetails.urgency === 'expired' || hostDetails.urgency === 'urgent';

                return (
                  <div key={record.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-red-950/10 transition-colors">
                    <div>
                      <span className="font-semibold text-white text-sm block">
                        {record.projectName}
                      </span>
                      {record.url && (
                        <a
                          href={record.url.startsWith('http') ? record.url : `https://${record.url}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1 mt-0.5 hover:underline"
                        >
                          {record.url} <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {isDomUrgent && (
                        <div className="flex items-center gap-1.5 bg-red-900/30 border border-red-800/40 rounded-lg px-2.5 py-1">
                          <Globe className="w-3.5 h-3.5 text-red-400" />
                          <span className="text-xs text-red-300 font-medium">Domain: {domDetails.label}</span>
                        </div>
                      )}
                      {isHostUrgent && (
                        <div className="flex items-center gap-1.5 bg-red-900/30 border border-red-800/40 rounded-lg px-2.5 py-1">
                          <Server className="w-3.5 h-3.5 text-red-400" />
                          <span className="text-xs text-red-300 font-medium">Hosting: {hostDetails.label}</span>
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
      <Card className="bg-slate-900 border-slate-800 shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div>
              <CardTitle className="text-white">Website & Domain Listing</CardTitle>
              <CardDescription className="text-slate-400">
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
                  className="pl-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500 w-full sm:w-65"
                />
              </div>

              <div>
                <Select
                  value={filter}
                  onValueChange={(val) => {
                    setFilter(val as any);
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-300 min-w-42.5">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
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
              <div className="grid grid-cols-12 gap-4 border-b border-slate-800 px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 bg-slate-900/35">
                <div className="col-span-2">Project Name</div>
                <div className="col-span-2">Website URL</div>
                <div className="col-span-3">Domain Expiry</div>
                <div className="col-span-3">Hosting Expiry</div>
                <div className="col-span-2">Package & Remarks</div>
              </div>

              {/* Table Body */}
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-12 gap-4 border-b border-slate-800/70 px-6 py-4">
                    <Skeleton className="col-span-2 h-5 bg-slate-800" />
                    <Skeleton className="col-span-2 h-5 bg-slate-800" />
                    <Skeleton className="col-span-3 h-5 bg-slate-800" />
                    <Skeleton className="col-span-3 h-5 bg-slate-800" />
                    <Skeleton className="col-span-2 h-5 bg-slate-800" />
                  </div>
                ))
              ) : records.length ? (
                records.map((record) => {
                  const domDetails = getExpiryDetails(record.domainExpireDate);
                  const hostDetails = getExpiryDetails(record.hostingExpireDate);

                  return (
                    <div
                      key={record.id}
                      className="grid grid-cols-12 gap-4 border-b border-slate-800/50 px-6 py-4.5 items-center hover:bg-slate-900/30 transition-colors last:border-0"
                    >
                      {/* Project Name */}
                      <div className="col-span-2 min-w-0">
                        <span className="text-sm font-semibold text-white block truncate" title={record.projectName}>
                          {record.projectName}
                        </span>
                        <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">
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
                            className="text-sm text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1.5 hover:underline truncate w-full"
                          >
                            <Globe className="w-3.5 h-3.5 shrink-0 text-indigo-400/80" />
                            <span className="truncate">{record.url}</span>
                            <ExternalLink className="w-3 h-3 shrink-0" />
                          </a>
                        ) : (
                          <span className="text-xs text-slate-600 italic">No URL</span>
                        )}
                      </div>

                      {/* Domain Expiry Details */}
                      <div className="col-span-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${domDetails.className}`}>
                            {domDetails.label}
                          </span>
                        </div>
                        {record.domainExpireDate && (
                          <div className="text-xs text-slate-300 font-medium flex items-center gap-1">
                            <CalendarDays className="w-3 h-3 text-slate-400" />
                            <span>{format(new Date(record.domainExpireDate), 'yyyy-MM-dd')}</span>
                          </div>
                        )}
                        {record.domainProvider && (
                          <div className="text-[10px] text-slate-500 font-medium">
                            Provider: <span className="text-slate-400">{record.domainProvider}</span>
                          </div>
                        )}
                      </div>

                      {/* Hosting Expiry Details */}
                      <div className="col-span-3 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${hostDetails.className}`}>
                            {hostDetails.label}
                          </span>
                        </div>
                        {record.hostingExpireDate && (
                          <div className="text-xs text-slate-300 font-medium flex items-center gap-1">
                            <CalendarDays className="w-3 h-3 text-slate-400" />
                            <span>{format(new Date(record.hostingExpireDate), 'yyyy-MM-dd')}</span>
                          </div>
                        )}
                        {(record.hostingProvider || record.hostingRemark) && (
                          <div className="text-[10px] text-slate-500 space-y-0.5">
                            {record.hostingProvider && (
                              <div>Provider: <span className="text-slate-400">{record.hostingProvider}</span></div>
                            )}
                            {record.hostingRemark && (
                              <div className="italic truncate max-w-50" title={record.hostingRemark}>
                                Remark: <span className="text-slate-400">{record.hostingRemark}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Package & Remarks */}
                      <div className="col-span-2 min-w-0 space-y-1.5">
                        {record.packageName ? (
                          <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px] truncate max-w-full">
                            Pkg: {record.packageName}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-slate-600 block italic">No Package</span>
                        )}
                        {record.remark ? (
                          <p className="text-xs text-slate-400 truncate w-full" title={record.remark}>
                            {record.remark}
                          </p>
                        ) : (
                          <span className="text-[10px] text-slate-600 block italic">No remarks</span>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                  <FileSpreadsheet className="mb-4 h-12 w-12 text-slate-650" />
                  <h3 className="text-lg font-semibold text-slate-300">No project expiries found</h3>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">
                    Upload your Expiry Check Excel sheet via Telegram to populate this dashboard.
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>

        {/* Pagination Footer */}
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/20 px-6 py-4 rounded-b-xl">
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
      </Card>
    </div>
  );
}
