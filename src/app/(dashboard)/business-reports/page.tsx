'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useDemandRecords } from '@/hooks/use-demand-records';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  BarChart3,
  TrendingUp,
  DollarSign,
  CalendarCheck,
  Megaphone,
  Search,
  Send,
  Briefcase,
} from 'lucide-react';

type DashboardStats = {
  totalSales: number;
  totalDemand: number;
  totalAppointments: number;
  totalMarketingBudget: number;
  topServices: { name: string; count: number; totalAmount: number; totalQty: number }[];
  projects: { name: string; status: string; note: string; lastUpdate: string }[];
};

function useBizStats() {
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

const statusColors: Record<string, string> = {
  on_track: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  completed: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  delayed: 'bg-red-500/10 text-red-400 border-red-500/20',
  at_risk: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  unknown: 'bg-slate-800 text-slate-400 border-slate-700',
};

export default function BusinessReportsPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: bizStats, isLoading: bizLoading } = useBizStats();
  const { data, isLoading } = useDemandRecords({
    page: 1,
    limit: 50,
    search: debouncedSearch || undefined,
    reportType: 'business_report',
  });

  const heroCards = [
    {
      title: 'Total Sales',
      value: bizStats?.totalSales ?? 0,
      icon: DollarSign,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      format: true,
    },
    {
      title: 'Total Demand',
      value: bizStats?.totalDemand ?? 0,
      icon: TrendingUp,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      format: true,
    },
    {
      title: 'Appointments',
      value: bizStats?.totalAppointments ?? 0,
      icon: CalendarCheck,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      format: false,
    },
    {
      title: 'Marketing Budget',
      value: bizStats?.totalMarketingBudget ?? 0,
      icon: Megaphone,
      color: 'text-amber-400',
      bg: 'bg-amber-500/10',
      format: true,
    },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            Business Reports
          </h1>
          <p className="text-slate-400">
            Sales, demand, services, appointments, and project tracking.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {heroCards.map((stat) => (
          <Card key={stat.title} className="bg-slate-900 border-slate-800 shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-400">{stat.title}</CardTitle>
              <div className={`p-2 rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {bizLoading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <div className="text-3xl font-bold text-white">
                  {stat.format ? stat.value.toLocaleString() : stat.value}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Top Services + Projects */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Top Services */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-indigo-400" />
              Top Services
            </CardTitle>
            <CardDescription className="text-slate-400">
              Best performing services by revenue
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bizLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full bg-slate-800 rounded-lg" />
                ))}
              </div>
            ) : bizStats?.topServices && bizStats.topServices.length > 0 ? (
              <div className="space-y-3">
                {bizStats.topServices.map((service, i) => {
                  const maxAmount = bizStats.topServices[0].totalAmount || 1;
                  const barWidth = Math.max((service.totalAmount / maxAmount) * 100, 8);
                  return (
                    <div key={i} className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-white truncate">{service.name}</span>
                        <div className="flex items-center gap-3 text-xs text-slate-400">
                          <span>{service.count} reports</span>
                          <span className="text-emerald-400 font-medium">{service.totalAmount.toLocaleString()}</span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-600 to-indigo-400 transition-all duration-500"
                          style={{ width: `${barWidth}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Briefcase className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No service data yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Projects */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-cyan-400" />
              Project Status
            </CardTitle>
            <CardDescription className="text-slate-400">
              Latest project updates
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bizLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full bg-slate-800 rounded-lg" />
                ))}
              </div>
            ) : bizStats?.projects && bizStats.projects.length > 0 ? (
              <div className="space-y-3">
                {bizStats.projects.map((project, i) => (
                  <div key={i} className="p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-white">{project.name}</span>
                      <Badge variant="outline" className={statusColors[project.status] || statusColors.unknown}>
                        {project.status.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 line-clamp-1">{project.note}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <BarChart3 className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No project data yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Report Records Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="hidden md:grid grid-cols-12 gap-3 border-b border-slate-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <div className="col-span-3">Reporter</div>
          <div className="col-span-4">Note</div>
          <div className="col-span-1">Sales</div>
          <div className="col-span-2">Service</div>
          <div className="col-span-1">Status</div>
          <div className="col-span-1 text-right">AI</div>
        </div>

        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-12 gap-3 border-b border-slate-800/70 px-4 py-4">
              <Skeleton className="col-span-3 h-5 bg-slate-800" />
              <Skeleton className="col-span-4 h-5 bg-slate-800" />
              <Skeleton className="col-span-1 h-5 bg-slate-800" />
              <Skeleton className="col-span-2 h-5 bg-slate-800" />
              <Skeleton className="col-span-1 h-5 bg-slate-800" />
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
                <p className="truncate text-sm font-medium text-white">{record.sender.displayName}</p>
                <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                  <Send className="h-3 w-3" />
                  {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                </p>
              </div>
              <div className="md:col-span-4 min-w-0">
                <p className="line-clamp-2 text-sm leading-6 text-slate-300">{record.note}</p>
              </div>
              <div className="md:col-span-1 text-sm text-slate-300">
                {record.totalSales ? record.totalSales.toLocaleString() : '-'}
              </div>
              <div className="md:col-span-2 min-w-0">
                <p className="truncate text-sm text-slate-400">{record.serviceName || '-'}</p>
              </div>
              <div className="md:col-span-1">
                <Badge variant="outline" className="bg-slate-800 text-slate-300 border-slate-700 text-xs">
                  {record.category}
                </Badge>
              </div>
              <div className="md:col-span-1 text-right text-xs text-slate-500">
                {Math.round(record.confidence * 100)}%
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <BarChart3 className="mb-3 h-9 w-9 text-slate-600" />
            <h3 className="text-lg font-medium text-slate-300">No business reports yet</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Send business reports via Telegram bot to see data here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
