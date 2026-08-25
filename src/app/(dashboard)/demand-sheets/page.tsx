'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, useRouter } from 'next/navigation';
import { useDateFilter } from '@/hooks/use-date-filter';
import { formatDistanceToNow, format } from 'date-fns';
import { DemandRecord } from '@/lib/api';
import {
  useDemandRecords,
  useDemandRecordStats,
  useDemandRecordRecommendations,
  useDeleteAllDemandRecords,
  useDeleteDemandRecord,
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
import { formatPhoneNumber } from '@/lib/utils';
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
  DollarSign,
  Megaphone,
  X,
  Filter,
  ChevronDown,
  ChevronUp,
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

function productTypeFor(name: string | null | undefined) {
  return /ebook|book|template|prompt pack|digital/i.test(name ?? '') ? 'Product' : 'Service';
}

type DashboardStats = {
  totalMessages: number;
  todayMessages: number;
  totalSenders: number;
  weekMessages: number;
  todayDemandRecords: number;
  dueTodayFollowUps: number;
  pendingDemandRecords: number;
  totalCustomers: number;
  newCustomers: number;
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
  totalCost: number;
  actualDemandCount?: number;
  actualAppointments?: number;
  demandRevenue?: number;
  reportRevenue?: number;
  salesFunnel?: {
    leads: number;
    appointments: number;
    closedDeals: number;
    appointmentConversionRate: number | null;
    closeConversionRate: number | null;
  };
  weeklyActivity: {
    date: string;
    count: number;
  }[];
  upcomingRecords: UpcomingRecord[];
};

function useDashboardStats(
  period: string,
  month: number,
  day: number,
  year: number,
  customFrom?: string,
  customTo?: string,
) {
  return useQuery({
    queryKey: ['dashboard-stats', period, month, day, year, customFrom, customTo],
    queryFn: async (): Promise<DashboardStats> => {
      const params = new URLSearchParams({
        period,
        month: String(month),
        day: String(day),
        year: String(year),
      });
      if (period === 'custom') {
        params.set('from', customFrom ?? '');
        params.set('to', customTo ?? '');
      }
      const res = await fetch(`/api/dashboard/stats?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 15000,
  });
}

function MonthlyDemandChart({ data }: { data: { month: string; count: number }[] }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const width = 640;
  const height = 280;
  const padding = { top: 28, right: 24, bottom: 42, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxCount = Math.max(...data.map(item => item.count), 1);
  const points = data.map((item, index) => {
    const x = padding.left + (plotWidth / Math.max(data.length - 1, 1)) * index;
    const y = padding.top + plotHeight - (item.count / maxCount) * plotHeight;
    return { ...item, x, y, index };
  });
  const linePath = points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1]?.x ?? padding.left} ${padding.top + plotHeight} L ${padding.left} ${padding.top + plotHeight} Z`;
  const yTicks = Array.from({ length: 5 }).map((_, index) => {
    const value = Math.round((maxCount / 4) * (4 - index));
    const y = padding.top + (plotHeight / 4) * index;
    return { value, y };
  });
  const slotWidth = points.length <= 1 ? plotWidth : plotWidth / (points.length - 1);

  return (
    <div className="relative rounded-xl bg-slate-50/80 dark:bg-slate-950/30 p-4 select-none">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-72 w-full overflow-visible" role="img" aria-label="Monthly demand generation chart">
        <defs>
          <linearGradient id="monthlyDemandFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map(tick => (
          <g key={`${tick.value}-${tick.y}`}>
            <line x1={padding.left} x2={width - padding.right} y1={tick.y} y2={tick.y} stroke="#e2e8f0" strokeWidth="1" />
            <text x={padding.left - 12} y={tick.y + 4} textAnchor="end" className="fill-slate-500 text-[11px] font-semibold">
              {tick.value}
            </text>
          </g>
        ))}
        <line x1={padding.left} x2={padding.left} y1={padding.top} y2={padding.top + plotHeight} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={padding.left} x2={width - padding.right} y1={padding.top + plotHeight} y2={padding.top + plotHeight} stroke="#cbd5e1" strokeWidth="1.5" />
        <path d={areaPath} fill="url(#monthlyDemandFill)" />
        <path d={linePath} fill="none" stroke="#f59e0b" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

        {/* Hover Guideline */}
        {hoveredIndex !== null && points[hoveredIndex] && (
          <line
            x1={points[hoveredIndex].x}
            y1={padding.top}
            x2={points[hoveredIndex].x}
            y2={padding.top + plotHeight}
            stroke="#f59e0b"
            strokeWidth="1.5"
            strokeDasharray="4 4"
            opacity={0.6}
          />
        )}

        {points.map(point => {
          const isHovered = hoveredIndex === point.index;
          return (
            <g key={point.month}>
              <circle
                cx={point.x}
                cy={point.y}
                r={isHovered ? 7 : 5}
                fill="#fff"
                stroke="#f59e0b"
                strokeWidth={isHovered ? 4 : 3}
              />
              <text
                x={point.x}
                y={padding.top + plotHeight + 26}
                textAnchor="middle"
                className={`text-[12px] ${isHovered ? 'fill-slate-900 dark:fill-white font-black' : 'fill-slate-600 font-bold'}`}
              >
                {point.month}
              </text>
            </g>
          );
        })}

        {/* Hover detection zones */}
        {points.map((point, idx) => (
          <rect
            key={`hz-${idx}`}
            x={point.x - slotWidth / 2}
            y={padding.top}
            width={slotWidth}
            height={plotHeight}
            fill="transparent"
            className="cursor-pointer"
            onMouseEnter={() => setHoveredIndex(idx)}
            onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
      </svg>

      {/* Floating Tooltip */}
      {hoveredIndex !== null && points[hoveredIndex] && (() => {
        const p = points[hoveredIndex];
        const xRatio = p.x / width;
        const yRatio = p.y / height;
        const transformX = xRatio > 0.8 ? '-95%' : xRatio < 0.2 ? '-5%' : '-50%';
        const transformY = yRatio < 0.28 ? '12px' : '-115%';

        return (
          <div
            className="absolute pointer-events-none z-20 transition-all duration-75"
            style={{
              left: `${xRatio * 100}%`,
              top: `${yRatio * 100}%`,
              transform: `translate(${transformX}, ${transformY})`,
            }}
          >
            <div className="bg-slate-800/95 dark:bg-slate-900/95 text-white text-[11px] px-3.5 py-2 rounded-lg shadow-xl backdrop-blur-sm whitespace-nowrap border border-slate-700/50" style={{ fontFamily: "'Inter', sans-serif" }}>
              <div className="font-bold mb-1 text-slate-200">{p.month}</div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
                <span className="text-slate-300">Demand Records:</span>
                <span className="font-bold text-amber-400">{p.count.toLocaleString()}</span>
              </div>
            </div>
          </div>
        );
      })()}
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

function DemandSheetsPageContent() {
  const router = useRouter();
  const {
    period,
    month,
    day,
    year,
    customFrom,
    customTo,
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
  } = useDateFilter('sales_filter');

  const searchParams = useSearchParams();
  const initialSearch = searchParams.get('search') || '';
  const initialStatus = searchParams.get('status') || 'all';
  const initialCategory = searchParams.get('category') || 'all';
  const initialPriority = searchParams.get('priority') || 'all';
  const initialMissingField = searchParams.get('missingField') || '';
  const initialFollowUpStatus = searchParams.get('followUpStatus') || 'all';

  const [search, setSearch] = useState(initialSearch);
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [categoryFilter, setCategoryFilter] = useState<string>(initialCategory);
  const [priorityFilter, setPriorityFilter] = useState<string>(initialPriority);
  const [missingField, setMissingField] = useState<string>(initialMissingField);
  const [followUpFilter, setFollowUpFilter] = useState<'all' | 'overdue' | 'due'>(
    initialFollowUpStatus === 'overdue' || initialFollowUpStatus === 'due' ? initialFollowUpStatus : 'all',
  );
  const [page, setPage] = useState(1);
  const [lastUrlFilters, setLastUrlFilters] = useState(
    () => `${initialPriority}:${initialStatus}:${initialCategory}:${initialSearch}:${initialMissingField}:${initialFollowUpStatus}`,
  );
  const [insightPage, setInsightPage] = useState(1);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showAiInsights, setShowAiInsights] = useState(false);
  const [showAllTopServices, setShowAllTopServices] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DemandRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<DemandRecord | null>(null);
  const [editStatus, setEditStatus] = useState<string>('new');
  const [editNote, setEditNote] = useState<string>('');
  const [editCustomerName, setEditCustomerName] = useState<string>('');
  const [editCustomerPhone, setEditCustomerPhone] = useState<string>('');
  const [editCustomerCompany, setEditCustomerCompany] = useState<string>('');
  const [editServiceName, setEditServiceName] = useState<string>('');
  const [editServiceAmount, setEditServiceAmount] = useState<string>('');
  const [editServiceQty, setEditServiceQty] = useState<string>('');
  const [editFollowUpDate, setEditFollowUpDate] = useState<string>('');
  const limit = 10;
  const insightPageSize = 5;

  const urlPriority = searchParams.get('priority') || 'all';
  const urlStatus = searchParams.get('status') || 'all';
  const urlCategory = searchParams.get('category') || 'all';
  const urlSearch = searchParams.get('search') || '';
  const urlMissingField = searchParams.get('missingField') || '';
  const urlFollowUpStatus = searchParams.get('followUpStatus') || 'all';
  const urlFilters = `${urlPriority}:${urlStatus}:${urlCategory}:${urlSearch}:${urlMissingField}:${urlFollowUpStatus}`;
  if (lastUrlFilters !== urlFilters) {
    setLastUrlFilters(urlFilters);
    setPriorityFilter(urlPriority);
    setStatusFilter(urlStatus);
    setCategoryFilter(urlCategory);
    setSearch(urlSearch);
    setDebouncedSearch(urlSearch);
    setMissingField(urlMissingField);
    setFollowUpFilter(urlFollowUpStatus === 'overdue' || urlFollowUpStatus === 'due' ? urlFollowUpStatus : 'all');
    setPage(1);
  }

  useEffect(() => {
    const priority = searchParams.get('priority');
    const missing = searchParams.get('missingField');
    const searchVal = searchParams.get('search');
    const followUpStatus = searchParams.get('followUpStatus');
    if ((priority && priority !== 'all') || missing || searchVal || followUpStatus) {
      const timer = setTimeout(() => {
        const element = document.getElementById('report-table-section');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const [lastDateFilter, setLastDateFilter] = useState(() => `${period}:${month}:${day}:${year}:${customFrom}:${customTo}`);
  const dateFilter = `${period}:${month}:${day}:${year}:${customFrom}:${customTo}`;
  if (lastDateFilter !== dateFilter) {
    setLastDateFilter(dateFilter);
    setPage(1);
  }

  const { data: stats, isLoading: statsLoading } = useDashboardStats(period, month, day, year, customFrom, customTo);
  const { data: demandStats, isLoading: demandStatsLoading } = useDemandRecordStats({ dateFrom, dateTo });
  const {
    data: recsData,
    isLoading: recsLoading,
    refetch: recsRefetch,
    isFetching: recsFetching,
  } = useDemandRecordRecommendations({ dateFrom, dateTo });

  const deleteAllMutation = useDeleteAllDemandRecords();
  const deleteMutation = useDeleteDemandRecord();
  const updateMutation = useUpdateDemandRecord();
  const insightTotal = recsData?.recommendations.length || 0;
  const insightTotalPages = Math.max(1, Math.ceil(insightTotal / insightPageSize));
  const currentInsightPage = Math.min(insightPage, insightTotalPages);
  const visibleInsights = recsData?.recommendations.slice(
    (currentInsightPage - 1) * insightPageSize,
    currentInsightPage * insightPageSize,
  ) || [];

  const handleDeleteAll = async () => {
    await deleteAllMutation.mutateAsync({ dateFrom, dateTo });
    setShowDeleteConfirm(false);
  };

  const handleEditClick = (record: DemandRecord) => {
    setEditingRecord(record);
    setEditStatus(record.status);
    setEditNote(record.note || '');
    setEditCustomerName(record.customerName || '');
    setEditCustomerPhone(record.customer?.phone || '');
    setEditCustomerCompany(record.customer?.company || '');
    setEditServiceName(record.serviceName || '');
    setEditServiceAmount(record.serviceAmount != null ? String(record.serviceAmount) : '');
    setEditServiceQty(record.serviceQty != null ? String(record.serviceQty) : '');
    setEditFollowUpDate(record.followUpDate ? record.followUpDate.slice(0, 10) : '');
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    await updateMutation.mutateAsync({
      id: editingRecord.id,
      status: editStatus,
      note: editNote,
      customerName: editCustomerName.trim(),
      customerPhone: editCustomerPhone.trim() || null,
      customerCompany: editCustomerCompany.trim() || null,
      serviceName: editServiceName.trim() || null,
      serviceAmount: editServiceAmount.trim() === '' ? null : Number(editServiceAmount),
      serviceQty: editServiceQty.trim() === '' ? undefined : Number(editServiceQty),
      followUpDate: editFollowUpDate || null,
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
    dateFrom,
    dateTo,
    missingField: missingField || undefined,
    followUpStatus: followUpFilter === 'all' ? undefined : followUpFilter,
    reportType: 'demand_report',
  });
  const { data: chartRecordsData, isLoading: chartRecordsLoading } = useDemandRecords({
    page: 1,
    limit: 100,
    dateFrom,
    dateTo,
    reportType: 'demand_report',
  });
  const monthlyDemandData = (() => {
    const now = new Date();
    const monthStart = Math.max(0, now.getMonth() - 5);
    const months = Array.from({ length: now.getMonth() - monthStart + 1 }).map((_, offset) => {
      const date = new Date(now.getFullYear(), monthStart + offset, 1);
      return {
        key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
        month: date.toLocaleDateString('en', { month: 'short' }),
        count: 0,
      };
    });
    const monthMap = new Map(months.map(month => [month.key, month]));
    chartRecordsData?.records.forEach(record => {
      const date = new Date(record.createdAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const month = monthMap.get(key);
      if (month) month.count += 1;
    });
    return months;
  })();
  const rankedServices = (demandStats?.services ?? []).filter((service) => service.salesCount > 0);
  const visibleRankedServices = showAllTopServices ? rankedServices : rankedServices.slice(0, 5);
  const maxServiceSales = Math.max(...rankedServices.map((service) => service.salesCount), 1);

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
          <h1 className="text-3xl font-bold  text-foreground mb-2 font-heading">Sales & Marketing</h1>
          <p className="text-muted-foreground text-sm">
            Marketing demand and lead quality.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 p-1.5 shadow-sm backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 lg:w-auto">
          <Select value={localPeriod} onValueChange={(value) => {
            if (value === 'overall' || value === 'day' || value === 'month' || value === 'year' || value === 'custom') {
              setLocalPeriod(value);
              updatePeriod({ period: value });
            }
          }}>
            <SelectTrigger className="h-9 w-36 rounded-lg border border-slate-200 bg-background text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
              {localPeriod === 'overall' ? 'Overall' : localPeriod === 'year' ? 'Yearly' : localPeriod === 'day' ? 'Daily' : localPeriod === 'custom' ? 'Custom range' : 'Monthly'}
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground rounded-lg">
              <SelectItem value="overall">Overall</SelectItem>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="year">Yearly</SelectItem>
              <SelectItem value="custom">Custom range</SelectItem>
            </SelectContent>
          </Select>
          {localPeriod === 'custom' ? (
            <div className="flex items-center gap-1.5"><Input type="date" value={customFrom} onChange={(event) => updatePeriod({ customFrom: event.target.value })} className="h-9 w-40 rounded-lg border border-slate-200 bg-background text-sm font-semibold shadow-sm dark:border-slate-700" aria-label="Start date" /><span className="px-1 text-xs font-medium text-muted-foreground">to</span><Input type="date" value={customTo} min={customFrom} onChange={(event) => updatePeriod({ customTo: event.target.value })} className="h-9 w-40 rounded-lg border border-slate-200 bg-background text-sm font-semibold shadow-sm dark:border-slate-700" aria-label="End date" /></div>
          ) : localPeriod === 'day' ? (
            <Input
              type="date"
              value={`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
              onChange={(event) => {
                const next = new Date(`${event.target.value}T00:00:00`);
                if (!Number.isNaN(next.getTime())) updatePeriod({ year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() });
              }}
              className="h-9 w-40 rounded-lg border border-slate-200 bg-background text-sm font-semibold shadow-sm dark:border-slate-700"
              aria-label="Select day"
            />
          ) : localPeriod === 'month' ? (
            <Select value={localMonth} onValueChange={(value) => {
              if (value) {
                setLocalMonth(value);
                updatePeriod({ month: Number(value) });
              }
            }}>
              <SelectTrigger className="h-9 w-32 rounded-lg border border-slate-200 bg-background text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
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
          {localPeriod !== 'day' && localPeriod !== 'overall' && localPeriod !== 'custom' && <Select value={localYear} onValueChange={(value) => {
            if (value) {
              setLocalYear(value);
              updatePeriod({ year: Number(value) });
            }
          }}>
            <SelectTrigger className="h-9 w-24 rounded-lg border border-slate-200 bg-background text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200">
              {localYear}
            </SelectTrigger>
            <SelectContent className="bg-card border-border text-foreground rounded-lg">
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
            disabled={!data?.total || deleteAllMutation.isPending}
            className="h-9 shrink-0 cursor-pointer rounded-lg border-red-900/50 bg-red-950/20 px-3 text-sm font-semibold text-red-700 shadow-sm hover:bg-red-900/40 hover:text-red-800 dark:text-red-800 dark:hover:text-red-200"
          >
            <Trash2 className="w-4 h-4 mr-1.5" />
            Delete All
          </Button>
        </div>
      </div>

      <div className="space-y-6">
          {/* Dashboard KPI cards */}
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            <Card className="bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl border-l-4 border-l-emerald-500 cursor-pointer">
              <CardContent className="p-6 flex flex-col justify-center h-32">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">Total Sales</p>
                    {statsLoading ? (
                      <Skeleton className="h-8 w-16 bg-muted" />
                    ) : (
                      <h3 className="flex items-baseline gap-1.5 whitespace-nowrap text-2xl font-black text-slate-900 tracking-tight dark:text-slate-100">
                        <span>{(stats?.totalAmountSold || 0).toLocaleString()}</span>
                        <span className="text-xs font-bold text-slate-400">MMK</span>
                      </h3>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                    <DollarSign className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl border-l-4 border-l-red-500 cursor-pointer">
              <CardContent className="p-6 flex flex-col justify-center h-32">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">Total Ad Expense</p>
                    {statsLoading ? (
                      <Skeleton className="h-8 w-16 bg-muted" />
                    ) : (
                      <h3 className="flex items-baseline gap-1.5 whitespace-nowrap text-2xl font-black text-slate-900 tracking-tight dark:text-slate-100">
                        <span>{(stats?.totalCost || 0).toLocaleString()}</span>
                        <span className="text-xs font-bold text-slate-400">MMK</span>
                      </h3>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                    <Megaphone className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl border-l-4 border-l-blue-500 cursor-pointer">
              <CardContent className="p-6 flex flex-col justify-center h-32">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">Demand Leads</p>
                    {statsLoading || demandStatsLoading ? (
                      <Skeleton className="h-8 w-16 bg-muted" />
                    ) : (
                      <h3 className="flex items-baseline gap-1.5 whitespace-nowrap text-2xl font-black text-slate-900 tracking-tight dark:text-slate-100">
                        <span>{(demandStats?.totalRecords ?? 0).toLocaleString()}</span>
                      </h3>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                    <FileSpreadsheet className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl border-l-4 border-l-amber-500 cursor-pointer">
              <CardContent className="p-6 flex flex-col justify-center h-32">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">Appointments</p>
                    {statsLoading ? (
                      <Skeleton className="h-8 w-16 bg-muted" />
                    ) : (
                      <h3 className="flex items-baseline gap-1.5 whitespace-nowrap text-2xl font-black text-slate-900 tracking-tight dark:text-slate-100">
                        <span>{(stats?.actualAppointments ?? 0).toLocaleString()}</span>
                      </h3>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                    <CalendarClock className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {demandStats?.insights && demandStats.insights.length > 0 && demandStats.totalRecords > 0 && (
            <Card className="border-2 border-sky-200 bg-sky-50/40 shadow-sm dark:border-sky-900 dark:bg-sky-950/20">
              <CardHeader className="py-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <CardTitle className="text-sm font-bold">Smart Suggestions</CardTitle>
                    <CardDescription>Suggestions are hidden until you choose to review them.</CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowAiInsights((show) => !show)} className="cursor-pointer">
                    {showAiInsights ? 'Hide suggestions' : 'View suggestions'}
                    {showAiInsights ? <ChevronUp className="ml-1.5 h-4 w-4" /> : <ChevronDown className="ml-1.5 h-4 w-4" />}
                  </Button>
                </div>
              </CardHeader>
              {showAiInsights && <CardContent className="grid gap-4 pt-0 md:grid-cols-2">
              {demandStats.insights.slice(0, 2).map((insight) => (
                <Card
                  key={insight.title}
                  className={`bg-card border-2 rounded-xl shadow-sm ${
                    insight.severity === 'urgent'
                      ? 'border-red-300 border-l-8 border-l-red-500'
                      : insight.severity === 'warning'
                      ? 'border-amber-300 border-l-8 border-l-amber-500'
                      : 'border-sky-300 border-l-8 border-l-sky-500'
                  }`}
                >
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
                    {insight.action && (
                      <div className="pt-1">
                        <Button
                          size="sm"
                          onClick={() => {
                            if (insight.actionType === 'view_high_priority') {
                              router.push('/sales-marketing?priority=high#report-table-section');
                            } else if (insight.actionType === 'view_missing_phone') {
                              router.push('/sales-marketing?missingField=phone#report-table-section');
                            } else if (insight.actionType === 'view_overdue') {
                              router.push('/sales-marketing?followUpStatus=overdue#report-table-section');
                            } else if (insight.actionType === 'view_due_today') {
                              router.push('/sales-marketing?followUpStatus=due#report-table-section');
                            } else {
                              const el = document.getElementById('report-table-section');
                              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                            }
                          }}
                          className={`${
                            insight.severity === 'urgent'
                              ? 'bg-red-600 hover:bg-red-700 text-white'
                              : insight.severity === 'warning'
                              ? 'bg-amber-500 hover:bg-amber-600 text-white'
                              : 'bg-sky-600 hover:bg-sky-700 text-white'
                          } text-xs font-bold rounded-lg px-4 h-8 cursor-pointer transition shadow-sm`}
                        >
                          {insight.action}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              </CardContent>}
            </Card>
          )}

          {/* Grid Layout */}
          <div className="grid gap-6 md:grid-cols-2">
            {/* Left: Top Services & Volume */}
            <div className="space-y-6">
              <Card className="glass-card border-border/70 shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
                        <Briefcase className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                        Top Products & Services
                      </CardTitle>
                      <CardDescription className="mt-1 text-muted-foreground text-xs">
                        Ranked by sales volume for the selected period
                      </CardDescription>
                    </div>
                    {rankedServices.length > 5 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowAllTopServices((show) => !show)}
                        className="h-8 shrink-0 cursor-pointer rounded-lg text-xs"
                      >
                        {showAllTopServices ? 'Show top 5' : `View all (${rankedServices.length})`}
                      </Button>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {demandStatsLoading ? (
                    <div className="space-y-4">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full bg-muted rounded" />
                      ))}
                    </div>
                  ) : rankedServices.length > 0 ? (
                    <div className="space-y-2">
                      {visibleRankedServices.map((service, index) => {
                          const barWidth = Math.max((service.salesCount / maxServiceSales) * 100, 8);
                          return (
                            <div key={service.serviceName} className="rounded-lg border border-border/70 bg-card/40 p-3 transition-colors hover:bg-muted/40">
                              <div className="flex items-center gap-3">
                                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold ${index < 3 ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}>
                                  {index + 1}
                                </span>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="truncate text-xs font-bold text-foreground">{service.serviceName}</span>
                                    <Badge variant="outline" className={`shrink-0 text-[9px] font-semibold ${productTypeFor(service.serviceName) === 'Product' ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300' : 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300'}`}>
                                      {productTypeFor(service.serviceName)}
                                    </Badge>
                                  </div>
                                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                                    <div className="h-full rounded-full bg-linear-to-r from-blue-600 to-sky-400 transition-all duration-500" style={{ width: `${barWidth}%` }} />
                                  </div>
                                </div>
                                <div className="shrink-0 text-right">
                                  <p className="text-xs font-extrabold text-foreground">{service.salesCount}</p>
                                  <p className="text-[10px] text-muted-foreground">sales</p>
                                  <p className="mt-0.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                    {service.revenue.toLocaleString()} MMK
                                  </p>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      No product or service sales in this period
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="glass-card border-border/70 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-foreground flex items-center gap-2 font-heading text-base">
                    <TrendingUp className="w-5 h-5 text-amber-600 dark:text-amber-400" />
                    Monthly Demand Generation
                  </CardTitle>
                  <CardDescription className="text-muted-foreground text-xs">
                    Demand records grouped by month
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {chartRecordsLoading ? (
                    <Skeleton className="h-72 w-full bg-card/60 rounded-lg" />
                  ) : (
                    <MonthlyDemandChart data={monthlyDemandData} />
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
                        Lead Insights (Smart Hotlist)
                      </CardTitle>
                      <CardDescription className="text-muted-foreground text-xs">
                        Local data-based priority recommendations
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
                  ) : (!isLoading && data?.total === 0) ? (
                    <div className="text-center py-8 text-slate-500 text-xs">
                      No insights available for this period
                    </div>
                  ) : recsData?.recommendations && recsData.recommendations.length > 0 ? (
                    <div className="space-y-3">
                      {visibleInsights.map((rec, idx) => (
                        <div
                          key={`${rec.customerName}-${idx}`}
                          onClick={() => setSearch(rec.customerName)}
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
                            Page {currentInsightPage} of {insightTotalPages} · {insightTotal} insights
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={currentInsightPage === 1}
                              onClick={() => setInsightPage((current) => Math.max(1, current - 1))}
                              className="h-8 rounded-lg border-border bg-card px-2.5 text-xs text-foreground hover:bg-muted/50 disabled:opacity-50 cursor-pointer"
                            >
                              <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                              Prev
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={currentInsightPage === insightTotalPages}
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
                        Pending inquiries will trigger Smart analysis
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
                      if (missingField) setMissingField('');
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
                      if (missingField) setMissingField('');
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
                      if (missingField) setMissingField('');
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

                <div>
                  <Select
                    value={followUpFilter}
                    onValueChange={(value) => {
                      if (value === 'all' || value === 'overdue' || value === 'due') {
                        setFollowUpFilter(value);
                        setPage(1);
                      }
                    }}
                  >
                    <SelectTrigger className="bg-muted/40 border-border text-foreground min-w-32.5 rounded-lg h-10">
                      <span>{followUpFilter === 'overdue' ? 'Overdue Follow-ups' : followUpFilter === 'due' ? 'Due Today' : 'All Follow-ups'}</span>
                    </SelectTrigger>
                    <SelectContent className="bg-card border-border text-foreground rounded-lg">
                      <SelectItem value="all">All Follow-ups</SelectItem>
                      <SelectItem value="overdue">Overdue Follow-ups</SelectItem>
                      <SelectItem value="due">Due Today</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Active filter badges */}
              {missingField === 'phone' && (
                <div className="flex items-center gap-2 pt-1">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs text-muted-foreground">Active filter:</span>
                  <span
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700"
                  >
                    <PhoneOff className="w-3 h-3" />
                    Missing Phone
                    <button
                      onClick={() => {
                        setMissingField('');
                        setPage(1);
                      }}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-red-200 dark:hover:bg-red-800 transition-colors cursor-pointer"
                      aria-label="Clear missing phone filter"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                  {data?.total === 0 && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold">
                      ✓ All leads have phone numbers
                    </span>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Report Records Table */}
          <div id="report-table-section" className="overflow-hidden rounded-lg border border-border bg-card/20 backdrop-blur-md shadow-sm">
            <div className="hidden md:grid grid-cols-12 gap-3 border-b border-border px-6 py-4.5 text-xs font-semibold uppercase  text-slate-500 bg-muted/40">
              <div className="col-span-1">Lead Date</div>
              <div className="col-span-2">Customer</div>
              <div className="col-span-1">Priority</div>
              <div className="col-span-1">Contact</div>
              <div className="col-span-2">Service / Package</div>
              <div className="col-span-2">Follow-up</div>
              <div className="col-span-2">Notes</div>
              <div className="col-span-1 text-right">Actions</div>
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
                  <Skeleton className="col-span-2 h-5 bg-muted" />
                  <Skeleton className="col-span-1 h-5 bg-muted" />
                </div>
              ))
            ) : data?.records.length ? (
              data.records.map(record => (
                <div
                  key={record.id}
                  className="grid grid-cols-1 gap-2.5 border-b border-border px-6 py-5 last:border-0 md:grid-cols-12 md:items-start md:gap-3 hover:bg-card/20 transition-all duration-200"
                >
                  {/* Date Column */}
                  <div className="md:col-span-1 whitespace-nowrap text-xs font-semibold text-muted-foreground">
                    <time dateTime={record.createdAt}>
                      {format(new Date(record.createdAt), 'd MMM yyyy')}
                    </time>
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
                      <span className="truncate" title={record.sender?.displayName ?? undefined}>
                        {record.sender?.displayName || 'System / Uploaded'}
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
                      <span>{formatPhoneNumber(record.customer.phone)}</span>
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
                      <Badge variant="outline" className="text-[10px] px-2 py-0 font-medium border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/30 dark:text-violet-300">
                        {productTypeFor(record.serviceName)}
                      </Badge>
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

                  {/* Notes */}
                  <div className="md:col-span-2 min-w-0">
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

                  {/* Actions */}
                  <div className="md:col-span-1 flex md:justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(record)}
                      className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg cursor-pointer transition-colors"
                      aria-label="Edit demand record"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingRecord(record)}
                      className="h-7 w-7 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg cursor-pointer transition-colors"
                      aria-label="Delete demand record"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
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

      {/* Edit Record Dialog */}
      {editingRecord && (
        <ModalPortal className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
          <div className="bg-card border border-border w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-lg shadow-lg animate-in zoom-in-95 duration-200 p-6 space-y-4 text-foreground backdrop-blur-xl">
            <div className="flex justify-between items-center border-b border-border pb-3 sticky top-0 bg-card z-10">
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

            {/* Customer Info */}
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase text-muted-foreground block">Customer</label>
              <Input
                value={editCustomerName}
                onChange={e => setEditCustomerName(e.target.value)}
                placeholder="Customer name"
                className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 rounded-lg h-10"
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  value={editCustomerPhone}
                  onChange={e => setEditCustomerPhone(e.target.value)}
                  placeholder="Phone number"
                  className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 rounded-lg h-10"
                />
                <Input
                  value={editCustomerCompany}
                  onChange={e => setEditCustomerCompany(e.target.value)}
                  placeholder="Company / shop"
                  className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 rounded-lg h-10"
                />
              </div>
            </div>

            {/* Service Info */}
            <div className="space-y-3">
              <label className="text-xs font-semibold uppercase text-muted-foreground block">Service / Package</label>
              <Input
                value={editServiceName}
                onChange={e => setEditServiceName(e.target.value)}
                placeholder="Service or package name"
                className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 rounded-lg h-10"
              />
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <span className="text-[11px] text-muted-foreground font-medium">Amount (MMK)</span>
                  <Input
                    type="number"
                    value={editServiceAmount}
                    onChange={e => setEditServiceAmount(e.target.value)}
                    placeholder="0"
                    className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 rounded-lg h-10"
                  />
                </div>
                <div className="space-y-1.5">
                  <span className="text-[11px] text-muted-foreground font-medium">Qty</span>
                  <Input
                    type="number"
                    value={editServiceQty}
                    onChange={e => setEditServiceQty(e.target.value)}
                    placeholder="0"
                    className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 rounded-lg h-10"
                  />
                </div>
              </div>
            </div>

            {/* Status */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-muted-foreground">Pipeline Status</label>
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

            {/* Follow-up Date */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-muted-foreground">Follow-up Date</label>
              <Input
                type="date"
                value={editFollowUpDate}
                onChange={e => setEditFollowUpDate(e.target.value)}
                className="bg-muted/50 border-border text-foreground focus-visible:ring-blue-500 rounded-lg h-10"
              />
            </div>

            {/* Note */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase text-muted-foreground">Notes / Remarks</label>
              <textarea
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
                placeholder="Enter note or update remarks..."
                className="w-full h-24 bg-muted/50 border border-border rounded-lg p-3.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground transition-all duration-200"
              />
            </div>

            <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-card">
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

      {deletingRecord && (
        <DestructiveConfirmDialog
          title="Delete demand record?"
          description={
            <>
              This moves the record for{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                {deletingRecord.customerName || 'Unknown customer'}
              </span>
              {' '}to Trash. Admins can restore it later.
            </>
          }
          confirmLabel="Delete record"
          notice="This record can be restored from Trash"
          isPending={deleteMutation.isPending}
          onCancel={() => setDeletingRecord(null)}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deletingRecord.id);
            setDeletingRecord(null);
          }}
        />
      )}

      {/* Delete All Confirmation Modal */}
      {showDeleteConfirm && (
        <DestructiveConfirmDialog
          title="Delete demand records for selected period?"
          description={
            <>
              This moves{' '}
              <span className="font-semibold text-red-700 dark:text-red-300">
                {data?.total || 0} demand record(s) from {dateFrom} to {dateTo}
              </span>
              {' '}to Trash. Linked customers are kept, and admins can restore these records later.
            </>
          }
          confirmationText="confirm"
          confirmationLabel="Type confirm to move these records to Trash"
          isPending={deleteAllMutation.isPending}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDeleteAll}
        />
      )}
    </div>
  );
}

export default function DemandSheetsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Loading Demand Sheets...</div>}>
      <DemandSheetsPageContent />
    </Suspense>
  );
}
