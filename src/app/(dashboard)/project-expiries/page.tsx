'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { format, differenceInDays, formatDistanceToNow } from 'date-fns';
import { useDateFilter } from '@/hooks/use-date-filter';
import { useProjectExpiries } from '@/hooks/use-project-expiries';
import { ProjectExpiration, WebsiteUpdate } from '@/lib/api';
import { useWebsiteUpdates, useUpdateWebsiteUpdate, useWebsiteUpdateRecommendations, useDeleteAllWebsiteUpdates } from '@/hooks/use-website-updates';
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
  AlertCircle,
  RefreshCw,
  FileSpreadsheet,
  Bot,
  Trash2,
  Edit2,
  Loader2,
  Wrench,
} from 'lucide-react';
import { useProjectExpiryRecommendations, useDeleteAllProjectExpiries, useUpdateProjectExpiry } from '@/hooks/use-project-expiries';

function ProjectExpiriesPageContent() {
  const {
    period,
    month,
    year,
    dateFrom,
    dateTo,
    localPeriod,
    localMonth,
    localYear,
    setLocalPeriod,
    setLocalMonth,
    setLocalYear,
    updatePeriod,
    years,
  } = useDateFilter('projects_filter');

  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';

  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<'all' | 'expired' | 'expiring_soon' | 'active'>('all');
  const [page, setPage] = useState(1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [lastUrlSearch, setLastUrlSearch] = useState(initialSearch);

  const urlSearch = searchParams.get('search') || '';
  if (lastUrlSearch !== urlSearch) {
    setLastUrlSearch(urlSearch);
    setSearch(urlSearch);
    setDebouncedSearch(urlSearch);
    setPage(1);
  }
  // Edit state
  const [editingRecord, setEditingRecord] = useState<ProjectExpiration | null>(null);
  const [editDomainExpiry, setEditDomainExpiry] = useState('');
  const [editHostingExpiry, setEditHostingExpiry] = useState('');
  const [editRemark, setEditRemark] = useState('');
  const [editPackageName, setEditPackageName] = useState('');
  const limit = 10;

  // Website Updates States
  const [websiteSearch, setWebsiteSearch] = useState('');
  const [debouncedWebsiteSearch, setDebouncedWebsiteSearch] = useState('');
  const [websiteStatusFilter, setWebsiteStatusFilter] = useState<'all' | 'up_to_date' | 'pending_update' | 'in_progress'>('all');
  const [websitePage, setWebsitePage] = useState(1);
  const [websiteInsightPage, setWebsiteInsightPage] = useState(1);
  const websiteLimit = 10;
  const websiteInsightPageSize = 5;

  // Editing state for updating status/remark of website updates
  const [editingWebsiteRecord, setEditingWebsiteRecord] = useState<WebsiteUpdate | null>(null);
  const [editWebsiteStatus, setEditWebsiteStatus] = useState<string>('up_to_date');
  const [editWebsiteRemark, setEditWebsiteRemark] = useState<string>('');
  const [showWebsiteDeleteConfirm, setShowWebsiteDeleteConfirm] = useState(false);
  const [lastDateFilter, setLastDateFilter] = useState(() => `${period}:${month}:${year}`);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedWebsiteSearch(websiteSearch);
      setWebsitePage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [websiteSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const dateFilter = `${period}:${month}:${year}`;
  if (lastDateFilter !== dateFilter) {
    setLastDateFilter(dateFilter);
    setPage(1);
    setWebsitePage(1);
  }

  const { data, isLoading } = useProjectExpiries({
    page,
    limit,
    search: debouncedSearch || undefined,
    filter: filter === 'all' ? undefined : filter,
    dateFrom,
    dateTo,
  });

  const { data: websiteData, isLoading: websiteLoading } = useWebsiteUpdates({
    page: websitePage,
    limit: websiteLimit,
    search: debouncedWebsiteSearch || undefined,
    status: websiteStatusFilter === 'all' ? undefined : websiteStatusFilter,
    dateFrom,
    dateTo,
  });

  const { refetch: recsRefetch } = useProjectExpiryRecommendations();

  // Website Update Hooks & Mutations
  const updateWebsiteMutation = useUpdateWebsiteUpdate();
  const { data: websiteRecsData, isLoading: websiteRecsLoading, refetch: websiteRecsRefetch, isFetching: websiteRecsFetching } = useWebsiteUpdateRecommendations();
  const websiteInsightTotal = websiteRecsData?.recommendations.length || 0;
  const [lastWebsiteInsightTotal, setLastWebsiteInsightTotal] = useState(websiteInsightTotal);
  const websiteInsightTotalPages = Math.max(1, Math.ceil(websiteInsightTotal / websiteInsightPageSize));
  const visibleWebsiteInsights = websiteRecsData?.recommendations.slice(
    (websiteInsightPage - 1) * websiteInsightPageSize,
    websiteInsightPage * websiteInsightPageSize,
  ) || [];

  if (lastWebsiteInsightTotal !== websiteInsightTotal) {
    setLastWebsiteInsightTotal(websiteInsightTotal);
    setWebsiteInsightPage(1);
  }

  const deleteWebsiteAllMutation = useDeleteAllWebsiteUpdates();

  const handleWebsiteDeleteAll = async () => {
    await deleteWebsiteAllMutation.mutateAsync({ dateFrom, dateTo });
    setShowWebsiteDeleteConfirm(false);
  };

  const handleWebsiteEditClick = (record: WebsiteUpdate) => {
    setEditingWebsiteRecord(record);
    setEditWebsiteStatus(record.status);
    setEditWebsiteRemark(record.remark || '');
  };

  const handleWebsiteSaveEdit = async () => {
    if (!editingWebsiteRecord) return;
    await updateWebsiteMutation.mutateAsync({
      id: editingWebsiteRecord.id,
      status: editWebsiteStatus,
      remark: editWebsiteRemark || null,
    });
    setEditingWebsiteRecord(null);
  };

  const deleteAllMutation = useDeleteAllProjectExpiries();
  const updateMutation = useUpdateProjectExpiry();

  const handleDeleteAll = async () => {
    await deleteAllMutation.mutateAsync({ dateFrom, dateTo });
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
  const prevTotalRef = useRef<number | null>(null);
  useEffect(() => {
    const total = data?.stats?.total;
    if (total === undefined) return;
    if (prevTotalRef.current !== null && total !== prevTotalRef.current) {
      recsRefetch();
    }
    prevTotalRef.current = total;
  }, [data?.stats?.total, recsRefetch]);

  // Auto-refresh Website AI insights once whenever the underlying record count changes
  const prevWebsiteTotalRef = useRef<number | null>(null);
  useEffect(() => {
    const total = websiteData?.stats?.total;
    if (total === undefined) return;
    if (prevWebsiteTotalRef.current !== null && total !== prevWebsiteTotalRef.current) {
      websiteRecsRefetch();
    }
    prevWebsiteTotalRef.current = total;
  }, [websiteData?.stats?.total, websiteRecsRefetch]);

  const stats = data?.stats || { total: 0, expired: 0, expiringSoon: 0, active: 0 };
  const records = data?.records || [];
  const websiteStats = websiteData?.stats || { total: 0, upToDate: 0, pendingUpdate: 0, inProgress: 0 };
  const websiteRecords = websiteData?.records || [];

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
    } else if (days === 0) {
      return {
        label: 'Expires Today',
        className: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border border-orange-500/20 font-medium animate-pulse',
        textClass: 'text-orange-600 dark:text-orange-400 font-semibold',
        urgency: 'urgent',
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

  const getWebsiteStatusBadge = (status: WebsiteUpdate['status']) => {
    if (status === 'up_to_date') {
      return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] font-bold">Up to date</Badge>;
    }
    if (status === 'in_progress') {
      return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] font-bold">In progress</Badge>;
    }
    return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200 text-[10px] font-bold">Pending update</Badge>;
  };



  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold  text-foreground font-heading">
            Project Expiries
          </h1>
          <p className="text-muted-foreground text-sm">
            Track and manage domain names, hosting servers, and active website subscription packages.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={localPeriod} onValueChange={(value) => {
            if (value === 'month' || value === 'year') {
              setLocalPeriod(value);
              updatePeriod({ period: value });
            }
          }}>
            <SelectTrigger className="h-9 w-28 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
              {localPeriod === 'year' ? 'Yearly' : 'Monthly'}
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground rounded-lg">
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
              <SelectTrigger className="h-9 w-32 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
                {new Date(Number(localYear), Number(localMonth) - 1, 1).toLocaleString('en', { month: 'long' })}
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground rounded-lg">
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
            <SelectTrigger className="h-9 w-24 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
              {localYear}
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground rounded-lg">
              {years.map((itemYear) => (
                <SelectItem key={itemYear} value={String(itemYear)}>
                  {itemYear}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={!records.length || deleteAllMutation.isPending}
            className="bg-red-950/20 border-red-900/50 text-red-700 dark:text-red-300 hover:bg-red-900/40 hover:text-red-800 dark:hover:text-red-200 h-9 rounded-lg shrink-0 cursor-pointer"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Delete All
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: 'Total Projects', value: stats.total, color: 'text-slate-900 dark:text-slate-100', icon: Globe, accent: 'border-l-4 border-l-slate-500' },
          { label: 'Expired', value: stats.expired, color: 'text-red-600 dark:text-red-400', icon: AlertTriangle, accent: 'border-l-4 border-l-red-500' },
          { label: 'Expiring Soon', value: stats.expiringSoon, color: 'text-orange-600 dark:text-orange-400', icon: Clock, accent: 'border-l-4 border-l-orange-500' },
          { label: 'Active & Safe', value: stats.active, color: 'text-emerald-600 dark:text-emerald-400', icon: CheckCircle, accent: 'border-l-4 border-l-emerald-500' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className={`bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl cursor-pointer ${item.accent}`}>
              <CardContent className="p-6 h-32 flex flex-col justify-center">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">{item.label}</p>
                    {isLoading ? (
                      <Skeleton className="h-8 w-16 bg-muted" />
                    ) : (
                      <h3 className={`text-2xl font-black ${item.color} tracking-tight font-mono`}>
                        {item.value.toLocaleString()}
                      </h3>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {!(isLoading || data?.total === 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="bg-white dark:bg-card border-2 border-red-300 border-l-8 border-l-red-500 rounded-xl shadow-sm flex flex-col justify-between">
            <CardContent className="p-5 flex flex-col h-full justify-between">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-2">Website သက်တမ်းတိုးရန် ကျန်ရှိမှု အနှစ်ချုပ်</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    သက်တမ်းကုန်ဆုံးသွားသော ပရောဂျက် ({stats.expired}) ခုနှင့် သက်တမ်းကုန်ဆုံးရန် နီးကပ်နေသော ပရောဂျက် ({stats.expiringSoon}) ခု ရှိနေပါသည်။ Website ပြတ်တောက်မှု မဖြစ်စေရန် ချက်ချင်းစစ်ဆေးလုပ်ဆောင်ပါ။
                  </p>
                </div>
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
              </div>
              {(stats.expired > 0 || stats.expiringSoon > 0) && (
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      const el = document.getElementById('project-listing-table');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg px-4 h-8 cursor-pointer transition shadow-sm border-none"
                  >
                    သက်တမ်းကုန်/ကုန်လုနီးများ စစ်ဆေးရန်
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-white dark:bg-card border-2 border-amber-300 border-l-8 border-l-amber-500 rounded-xl shadow-sm flex flex-col justify-between">
            <CardContent className="p-5 flex flex-col h-full justify-between">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-2">Website Update/Maintenance အနှစ်ချုပ်</h4>
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    Updateလုပ်ရန် ကျန်ရှိနေသော Website ({websiteStats.pendingUpdate}) ခုနှင့် လက်ရှိလုပ်ဆောင်နေဆဲ Project ({websiteStats.inProgress}) ခု ရှိနေပါသည်။ အချိန်မီအပ်ဒိတ်လုပ်ဆောင်ရန် စစ်ဆေးပါ။
                  </p>
                </div>
                <Wrench className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
              </div>
              {(websiteStats.pendingUpdate > 0 || websiteStats.inProgress > 0) && (
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      const el = document.getElementById('website-maintenance-table');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg px-4 h-8 cursor-pointer transition shadow-sm border-none"
                  >
                    Update/Maintenance မှတ်တမ်းများ စစ်ဆေးရန်
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>


        </div>
      )}

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
      <Card id="project-listing-table" className="glass-card border-border/70 shadow-sm">
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

      {/* Website Updates section */}
      <div className="space-y-6 pt-4 border-t-2 border-slate-100">
        <div className="flex items-center justify-between border-b-2 border-slate-200 pb-4">
          <div>
            <h2 className="text-xl font-bold text-foreground uppercase tracking-wide">Website Updates & Maintenance</h2>
            <p className="text-xs text-muted-foreground mt-1">Monitor package subscriptions, business types, and change update status for active websites.</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowWebsiteDeleteConfirm(true)}
            disabled={!websiteRecords.length || deleteWebsiteAllMutation.isPending}
            className="bg-red-950/30 border-red-900/50 text-red-700 dark:text-red-300 hover:bg-red-900/40 hover:text-red-800 dark:hover:text-red-200 dark:text-red-800 shrink-0 cursor-pointer h-9 px-3.5 rounded-lg"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Delete All
          </Button>
        </div>

        {/* Website updates KPI cards */}
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
          {[
            { label: 'Total Websites', value: websiteStats.total, className: '' },
            { label: 'Pending Updates', value: websiteStats.pendingUpdate, className: 'border-l-4 border-l-red-500/60 text-red-600' },
            { label: 'In Progress', value: websiteStats.inProgress, className: 'border-l-4 border-l-amber-500/60 text-amber-600' },
            { label: 'Up to Date', value: websiteStats.upToDate, className: 'border-l-4 border-l-emerald-500/60 text-emerald-600' },
          ].map((item) => (
            <Card key={item.label} className={`bg-card border-2 border-slate-200 shadow-sm ${item.className}`}>
              <CardContent className="p-5">
                <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">{item.label}</p>
                {websiteLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-2xl font-bold font-mono">{item.value}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      
        {/* Website Maintenance Alerts */}
        {websiteStats.total > 0 && (
          <div className="grid gap-4 md:grid-cols-2">
          <Card
            className={`bg-white dark:bg-card border-2 rounded-xl shadow-sm flex flex-col justify-between ${
              websiteStats.pendingUpdate > 0
                ? 'border-red-300 border-l-8 border-l-red-500'
                : 'border-emerald-300 border-l-8 border-l-emerald-500'
            }`}
          >
            <CardContent className="p-5 flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <AlertCircle className={`w-5 h-5 shrink-0 ${websiteStats.pendingUpdate > 0 ? 'text-red-600' : 'text-emerald-600'}`} />
                  <h4 className="font-bold text-slate-900 dark:text-slate-100">Website အပ်ဒိတ်လုပ်ရန် ကျန်ရှိမှု</h4>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-1 leading-relaxed">
                  Website (${websiteStats.pendingUpdate}) ခုသည် နောက်ဆုံးရ အပ်ဒိတ်လုပ်ရန် ကျန်ရှိနေပါသည်။ သုံးစွဲသူအတွေ့အကြုံ ကောင်းမွန်စေရန် အမြန်ဆုံး အပ်ဒိတ်လုပ်ရန် လိုအပ်သည်။
                </p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-300 leading-relaxed">
                  {websiteStats.pendingUpdate > 0
                    ? "ပြုပြင်ထိန်းသိမ်းမှု အခြေအနေများကို စစ်ဆေးပြီး အပ်ဒိတ်လုပ်ရန် ကျန်ရှိသည်များကို ဆောင်ရွက်ပါ။"
                    : "Website များအားလုံး အပ်ဒိတ်များ နောက်ဆုံးပေါ် ဖြစ်နေပါသည်။"}
                </p>
              </div>
              {websiteStats.pendingUpdate > 0 && (
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      setWebsiteStatusFilter('pending_update');
                      setWebsitePage(1);
                      const el = document.getElementById('website-maintenance-table');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className={`${
                      websiteStats.pendingUpdate > 0
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    } text-xs font-bold rounded-lg px-4 h-8 cursor-pointer transition shadow-sm border-none`}
                  >
                    အပ်ဒိတ်လုပ်ရန် ကျန်သည်များ စစ်ဆေးရန်
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card
            className={`bg-white dark:bg-card border-2 rounded-xl shadow-sm flex flex-col justify-between ${
              websiteStats.inProgress > 0
                ? 'border-amber-300 border-l-8 border-l-amber-500'
                : 'border-sky-300 border-l-8 border-l-sky-500'
            }`}
          >
            <CardContent className="p-5 flex flex-col h-full justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <Wrench className={`w-5 h-5 shrink-0 ${websiteStats.inProgress > 0 ? 'text-amber-600' : 'text-sky-650'}`} />
                  <h4 className="font-bold text-slate-900 dark:text-slate-100">Website ပြုပြင်ထိန်းသိမ်းမှု (In Progress)</h4>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-1 leading-relaxed">
                  Website (${websiteStats.inProgress}) ခုအား ပြုပြင်ထိန်းသိမ်းမှု (In Progress) လုပ်ဆောင်နေပါသည်။
                </p>
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-300 leading-relaxed">
                  {websiteStats.inProgress > 0
                    ? "လုပ်ဆောင်ဆဲပရောဂျက်၏ အဆင်ပြေချောမွေ့စွာ ပြီးစီးနိုင်ရေးကို စောင့်ကြည့်စစ်ဆေးပါ။"
                    : "လတ်တလော ပြုပြင်ထိန်းသိမ်းမှု လုပ်ဆောင်နေသည့် Website မရှိပါ။"}
                </p>
              </div>
              {websiteStats.inProgress > 0 && (
                <div className="mt-4">
                  <Button
                    size="sm"
                    onClick={() => {
                      setWebsiteStatusFilter('in_progress');
                      setWebsitePage(1);
                      const el = document.getElementById('website-maintenance-table');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-lg px-4 h-8 cursor-pointer transition shadow-sm border-none"
                  >
                    လုပ်ဆောင်ဆဲ မှတ်တမ်းကြည့်ရန်
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

        {/* Website updates AI Insights Card */}
        <Card className="rounded-xl border-2 border-slate-200 bg-card shadow-sm">
          <CardHeader className="p-5 border-b border-slate-200">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-foreground text-sm font-bold uppercase tracking-wider flex items-center gap-2">
                  <Bot className="w-5 h-5 text-blue-600 dark:text-blue-400 animate-pulse" />
                  Website Maintenance Recommendations
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-1">
                  AI recommendations for pending website updates and site maintenance.
                </CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => websiteRecsRefetch()}
                disabled={websiteRecsFetching}
                className="bg-card border-border text-foreground hover:bg-muted/50 shrink-0 cursor-pointer h-9 px-3 rounded-lg"
              >
                <RefreshCw className={`w-4 h-4 mr-1.5 ${websiteRecsFetching ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-5">
            {websiteRecsLoading || websiteRecsFetching ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full bg-muted rounded-lg animate-pulse" />
                <Skeleton className="h-12 w-full bg-muted rounded-lg animate-pulse" />
                <Skeleton className="h-12 w-full bg-muted rounded-lg animate-pulse" />
              </div>
            ) : (!websiteLoading && websiteData?.total === 0) ? (
              <div className="text-center py-8 text-slate-500">
                <Bot className="w-8 h-8 text-slate-400 mx-auto mb-2 animate-pulse" />
                <p className="text-sm font-semibold text-muted-foreground">No website updates recorded for this period</p>
              </div>
            ) : websiteRecsData?.recommendations && websiteRecsData.recommendations.length > 0 ? (
              <div className="space-y-3">
                {visibleWebsiteInsights.map((rec, idx) => (
                  <div
                    key={`${rec.websiteName}-${idx}`}
                    onClick={() => {
                      setWebsiteSearch(rec.websiteName);
                      const el = document.getElementById('website-maintenance-table');
                      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }}
                    className="flex items-start gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer"
                  >
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 animate-pulse" />
                    </div>
                    <div className="flex-1 flex flex-col justify-between sm:flex-row sm:items-center gap-3">
                      <div>
                        <p className="text-xs font-bold text-slate-800">{rec.websiteName}</p>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{rec.insight}</p>
                      </div>
                      <div className="shrink-0 self-start sm:self-center">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs font-bold border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg px-3 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            setWebsiteSearch(rec.websiteName);
                            const el = document.getElementById('website-maintenance-table');
                            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          }}
                        >
                          မှတ်တမ်း ရှာဖွေရန်
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
                {websiteInsightTotalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-200 pt-4">
                    <p className="text-[11px] font-mono text-muted-foreground">
                      Page {websiteInsightPage} of {websiteInsightTotalPages} · {websiteInsightTotal} insights
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={websiteInsightPage === 1}
                        onClick={() => setWebsiteInsightPage((current) => Math.max(1, current - 1))}
                        className="h-8 rounded-lg border-slate-200 bg-card px-2.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-50 cursor-pointer"
                      >
                        <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                        Prev
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={websiteInsightPage === websiteInsightTotalPages}
                        onClick={() => setWebsiteInsightPage((current) => Math.min(websiteInsightTotalPages, current + 1))}
                        className="h-8 rounded-lg border-slate-200 bg-card px-2.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-50 cursor-pointer"
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
                <Bot className="w-8 h-8 text-slate-450 mx-auto mb-2" />
                <p className="text-sm font-semibold">No pending maintenance actions</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
                  AI insights appear only for sites marked <span className="text-amber-600 font-semibold">Pending Update</span> or <span className="text-amber-600 font-semibold">In Progress</span>. Set a status via the edit button to get recommendations.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Website updates list directory card */}
        <Card id="website-maintenance-table" className="bg-card border-2 border-slate-200 shadow-sm rounded-xl overflow-hidden">
          <CardHeader className="p-5 border-b-2 border-slate-200">
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
              <div>
                <CardTitle className="text-foreground text-sm font-bold uppercase tracking-wide">Website Maintenance Directory</CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-1">
                  Filter by maintenance status, search by domain, or manage update actions.
                </CardDescription>
              </div>

              {/* Filter controls */}
              <div className="flex flex-wrap gap-3 w-full sm:w-auto">
                <div className="relative flex-1 sm:flex-initial">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-450" />
                  <Input
                    placeholder="Search project, URL, package..."
                    value={websiteSearch}
                    onChange={(e) => {
                      setWebsiteSearch(e.target.value);
                      setWebsitePage(1);
                    }}
                    className="pl-9 bg-muted/50 border-slate-250 text-foreground placeholder:text-muted-foreground focus-visible:ring-blue-500 w-full sm:w-64 text-xs h-9"
                  />
                </div>

                <div>
                  <Select
                    value={websiteStatusFilter}
                    onValueChange={(val) => {
                      setWebsiteStatusFilter(
                        (val as 'all' | 'up_to_date' | 'pending_update' | 'in_progress') || 'all',
                      );
                      setWebsitePage(1);
                    }}
                  >
                    <SelectTrigger className="bg-muted/50 border-slate-250 text-foreground min-w-40 text-xs h-9">
                      <SelectValue placeholder="All Statuses" />
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground">
                      <SelectItem value="all">All Statuses</SelectItem>
                      <SelectItem value="up_to_date">Up to Date</SelectItem>
                      <SelectItem value="pending_update">Pending Update</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider font-extrabold border-b-2 border-slate-200">
                  <tr>
                    <th className="px-6 py-4">Name / Business Type</th>
                    <th className="px-6 py-4">Website Link</th>
                    <th className="px-6 py-4">Package</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Remarks & Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y-2 divide-slate-100">
                  {websiteLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index}>
                        {Array.from({ length: 5 }).map((__, cellIndex) => (
                          <td key={cellIndex} className="px-6 py-4"><Skeleton className="h-4 w-24 animate-pulse" /></td>
                        ))}
                      </tr>
                    ))
                  ) : websiteRecords.length ? (
                    websiteRecords.map((record) => {
                      return (
                        <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                          {/* Name / Business Type */}
                          <td className="px-6 py-4 font-bold text-slate-800">
                            <span className="block truncate max-w-[200px]" title={record.name}>
                              {record.name}
                            </span>
                            {record.businessType ? (
                              <span className="text-[10px] text-slate-500 font-semibold block mt-0.5 truncate max-w-[200px]" title={record.businessType}>
                                {record.businessType}
                              </span>
                            ) : (
                              <span className="text-[9px] text-slate-400 block mt-0.5 italic">No Business Type</span>
                            )}
                          </td>

                          {/* Website Link */}
                          <td className="px-6 py-4">
                            {record.url ? (
                              <a
                                href={record.url.startsWith('http') ? record.url : `https://${record.url}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 font-semibold inline-flex items-center gap-1 hover:underline truncate max-w-[200px]"
                              >
                                <span className="truncate">{record.url}</span>
                                <ExternalLink className="w-3 h-3 shrink-0" />
                              </a>
                            ) : (
                              <span className="text-slate-400 italic">No URL</span>
                            )}
                          </td>

                          {/* Package Name */}
                          <td className="px-6 py-4 text-slate-600 font-semibold">
                            {record.packageName ? (
                              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold">
                                {record.packageName}
                              </Badge>
                            ) : (
                              <span className="text-slate-400 italic">—</span>
                            )}
                          </td>

                          {/* Status */}
                          <td className="px-6 py-4">
                            {getWebsiteStatusBadge(record.status)}
                            <span className="text-[9px] text-slate-400 block mt-1">
                              Updated: {formatDistanceToNow(new Date(record.updatedAt), { addSuffix: true })}
                            </span>
                          </td>

                          {/* Remarks & Actions */}
                          <td className="px-6 py-4 max-w-xs">
                            <div className="flex items-center justify-between gap-3">
                              <div className="truncate flex-1 font-semibold text-slate-650" title={record.remark || undefined}>
                                {record.remark || '—'}
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleWebsiteEditClick(record)}
                                className="h-8 w-8 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg shrink-0 cursor-pointer"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-6 py-10 text-center text-slate-500 font-semibold">
                        No website updates found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>

          {/* Pagination Footer */}
          {websiteData && websiteData.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-6 py-4">
              <div className="text-xs text-muted-foreground font-mono">
                Showing Page <span className="text-slate-850 font-semibold">{websitePage}</span> of{' '}
                <span className="text-slate-850 font-semibold">{websiteData.totalPages}</span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={websitePage === 1}
                  onClick={() => setWebsitePage(p => Math.max(1, p - 1))}
                  className="bg-card border-slate-200 text-foreground hover:bg-slate-50 disabled:opacity-50 cursor-pointer h-9 px-3.5 rounded-lg"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Prev
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={websitePage === websiteData.totalPages}
                  onClick={() => setWebsitePage(p => Math.min(websiteData.totalPages, p + 1))}
                  className="bg-card border-slate-200 text-foreground hover:bg-slate-50 disabled:opacity-50 cursor-pointer h-9 px-3.5 rounded-lg"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Edit Project Expiry Dialog */}
      {editingRecord && (
        <ModalPortal className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
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
        </ModalPortal>
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteConfirm && (
        <DestructiveConfirmDialog
          title="Delete project expiries for selected period?"
          description={
            <>
              This moves{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                {stats.total} project record(s) from {dateFrom} to {dateTo}
              </span>
              {' '}to Trash. Admins can restore them later or permanently delete them from Trash.
            </>
          }
          confirmationText="confirm"
          confirmationLabel="Type confirm to move these records to Trash"
          isPending={deleteAllMutation.isPending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteAll}
        />
      )}

      {/* Edit Website Update Dialog */}
      {editingWebsiteRecord && (
        <ModalPortal className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
          <div className="bg-card border border-border w-full max-w-lg rounded-lg overflow-hidden shadow-lg animate-in zoom-in-95 duration-200 p-6 space-y-4 text-foreground backdrop-blur-xl">
            <div className="flex justify-between items-center border-b border-border pb-3">
              <div>
                <h3 className="text-base font-bold text-foreground font-heading">Manage Website Maintenance</h3>
                <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-xs">{editingWebsiteRecord.name}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setEditingWebsiteRecord(null)} className="text-muted-foreground hover:text-foreground cursor-pointer">
                ✕
              </Button>
            </div>

            {/* Status Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Update Status
              </label>
              <Select
                value={editWebsiteStatus}
                onValueChange={(val) => setEditWebsiteStatus(val || 'up_to_date')}
              >
                <SelectTrigger className="bg-muted/50 border border-border text-foreground focus-visible:ring-blue-500 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border text-foreground">
                  <SelectItem value="up_to_date">Up to Date</SelectItem>
                  <SelectItem value="pending_update">Pending Update</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Remarks Input */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-muted-foreground">
                Maintenance Notes / Remarks
              </label>
              <textarea
                value={editWebsiteRemark}
                onChange={(e) => setEditWebsiteRemark(e.target.value)}
                placeholder="Enter update tasks, details, or issues..."
                className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground transition-all duration-200"
              />
            </div>

            {/* Save Buttons */}
            <div className="flex justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setEditingWebsiteRecord(null)}
                className="bg-muted/50 border-border text-foreground hover:bg-card cursor-pointer rounded-lg h-10 px-4"
              >
                Cancel
              </Button>
              <Button
                onClick={handleWebsiteSaveEdit}
                disabled={updateWebsiteMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer rounded-lg h-10 px-4"
              >
                {updateWebsiteMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />
                )}
                Save Changes
              </Button>
            </div>
          </div>
        </ModalPortal>
      )}

      {/* Delete All Website Records Confirmation Modal */}
      {showWebsiteDeleteConfirm && (
        <DestructiveConfirmDialog
          title="Delete website records for selected period?"
          description={
            <>
              This moves{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                {websiteStats.total} website record(s) from {dateFrom} to {dateTo}
              </span>
              {' '}to Trash. Admins can restore them later or permanently delete them from Trash.
            </>
          }
          confirmationText="confirm"
          confirmationLabel="Type confirm to move these records to Trash"
          isPending={deleteWebsiteAllMutation.isPending}
          onCancel={() => setShowWebsiteDeleteConfirm(false)}
          onConfirm={handleWebsiteDeleteAll}
        />
      )}
    </div>
  );
}

export default function ProjectExpiriesPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Loading Project Expiries...</div>}>
      <ProjectExpiriesPageContent />
    </Suspense>
  );
}
