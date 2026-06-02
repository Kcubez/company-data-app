'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import {
  ClipboardList,
  CalendarClock,
  FileText,
  TrendingUp,
  Search,
  Send,
  Clock,
} from 'lucide-react';
import { useDemandRecords } from '@/hooks/use-demand-records';
import { dailyReportApi } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const statusOptions = [
  { value: '', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'pending', label: 'Pending' },
  { value: 'closed', label: 'Closed' },
];

function useDailyReportStats() {
  return useQuery({
    queryKey: ['daily-report-stats'],
    queryFn: () => dailyReportApi.stats(),
    refetchInterval: 10000,
  });
}

export default function DailyReportPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: stats, isLoading: statsLoading } = useDailyReportStats();
  const { data, isLoading } = useDemandRecords({
    page: 1,
    limit: 50,
    search: debouncedSearch || undefined,
    status: status || undefined,
    reportType: 'daily_report',
  });

  const statCards = [
    {
      title: 'Total Reports',
      value: stats?.totalReports ?? 0,
      icon: FileText,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
    },
    {
      title: "Today's Reports",
      value: stats?.todayReports ?? 0,
      icon: ClipboardList,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      title: 'Due Today',
      value: stats?.dueToday ?? 0,
      icon: CalendarClock,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
    },
    {
      title: 'Pending',
      value: stats?.pendingReports ?? 0,
      icon: Clock,
      color: 'text-rose-400',
      bg: 'bg-rose-500/10',
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            Daily Reports
          </h1>
          <p className="text-slate-400">
            Employee daily progress and work reports.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search reports..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
            />
          </div>
          <FilterSelect value={status} onChange={setStatus} options={statusOptions} />
        </div>
      </div>

      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.title} className="bg-slate-900 border-slate-800 shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-400">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {statsLoading ? (
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

      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="grid grid-cols-12 gap-3 border-b border-slate-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <div className="col-span-3">Employee</div>
          <div className="col-span-6">Report</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">AI</div>
        </div>

        {isLoading ? (
          Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="grid grid-cols-12 gap-3 border-b border-slate-800/70 px-4 py-4">
              <Skeleton className="col-span-3 h-5 bg-slate-800" />
              <Skeleton className="col-span-6 h-5 bg-slate-800" />
              <Skeleton className="col-span-2 h-5 bg-slate-800" />
              <Skeleton className="col-span-1 h-5 bg-slate-800" />
            </div>
          ))
        ) : data?.records.length ? (
          data.records.map((record) => (
            <div
              key={record.id}
              className="grid grid-cols-1 gap-3 border-b border-slate-800/70 px-4 py-4 last:border-0 md:grid-cols-12 md:items-start"
            >
              <div className="md:col-span-3 min-w-0">
                <p className="truncate text-sm font-medium text-white">
                  {record.sender.displayName}
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  <Send className="h-3 w-3" />
                  {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                </p>
              </div>
              <div className="md:col-span-6 min-w-0">
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300 break-words">
                  {record.note}
                </p>
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-2">
                <StatusBadge status={record.status} />
              </div>
              <div className="md:col-span-1 text-right text-xs text-slate-500">
                {Math.round(record.confidence * 100)}%
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <FileText className="mb-3 h-9 w-9 text-slate-600" />
            <h3 className="text-lg font-medium text-slate-300">No daily reports yet</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Employee daily reports from Telegram will appear here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-10 rounded-lg border border-slate-700 bg-slate-800/50 px-3 text-sm text-slate-200 outline-none transition-colors focus:border-indigo-500"
    >
      {options.map((option) => (
        <option key={option.label} value={option.value} className="bg-slate-900 text-slate-200">
          {option.label}
        </option>
      ))}
    </select>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color =
    status === 'closed'
      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
      : status === 'pending'
        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        : status === 'quoted'
          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
          : 'bg-slate-800 text-slate-300 border-slate-700';

  return (
    <Badge variant="outline" className={color}>
      {status}
    </Badge>
  );
}