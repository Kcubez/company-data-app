'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { useDemandRecords } from '@/hooks/use-demand-records';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Lightbulb,
  UserCheck,
  Target,
  AlertTriangle,
  ArrowRight,
  Search,
} from 'lucide-react';

type PlanStats = {
  followUps: { client: string; reason: string | null; date: string }[];
  focusServices: { service: string; reason: string | null }[];
  delayedProjects: { project: string; reason: string | null }[];
  planCount: number;
};

function usePlanStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<PlanStats> => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 15000,
  });
}

export default function FuturePlansPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: planStats, isLoading: statsLoading } = usePlanStats();
  const { data, isLoading } = useDemandRecords({
    page: 1,
    limit: 50,
    search: debouncedSearch || undefined,
    reportType: 'future_plan',
  });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
            Future Plans
          </h1>
          <p className="text-slate-400">
            Follow-ups, focus areas, delayed projects, and next steps.
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search plans..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 grid-cols-1 md:grid-cols-3">
        {/* Follow-ups */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2 text-base">
              <UserCheck className="w-5 h-5 text-blue-400" />
              Follow-up Clients
            </CardTitle>
            <CardDescription className="text-slate-400">
              Clients that need follow-up
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full bg-slate-800 rounded-lg" />
                ))}
              </div>
            ) : planStats?.followUps && planStats.followUps.length > 0 ? (
              <div className="space-y-2">
                {planStats.followUps.map((f, i) => (
                  <div key={i} className="p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowRight className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <span className="text-sm font-medium text-white">{f.client}</span>
                    </div>
                    {f.reason && <p className="text-xs text-slate-500 ml-6">{f.reason}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">No follow-ups yet</p>
            )}
          </CardContent>
        </Card>

        {/* Focus Services */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2 text-base">
              <Target className="w-5 h-5 text-emerald-400" />
              Focus Services
            </CardTitle>
            <CardDescription className="text-slate-400">
              Services to prioritize
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full bg-slate-800 rounded-lg" />
                ))}
              </div>
            ) : planStats?.focusServices && planStats.focusServices.length > 0 ? (
              <div className="space-y-2">
                {planStats.focusServices.map((f, i) => (
                  <div key={i} className="p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <Target className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <span className="text-sm font-medium text-white">{f.service}</span>
                    </div>
                    {f.reason && <p className="text-xs text-slate-500 ml-6">{f.reason}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">No focus services yet</p>
            )}
          </CardContent>
        </Card>

        {/* Delayed Projects */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2 text-base">
              <AlertTriangle className="w-5 h-5 text-red-400" />
              Delayed Projects
            </CardTitle>
            <CardDescription className="text-slate-400">
              Projects needing attention
            </CardDescription>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full bg-slate-800 rounded-lg" />
                ))}
              </div>
            ) : planStats?.delayedProjects && planStats.delayedProjects.length > 0 ? (
              <div className="space-y-2">
                {planStats.delayedProjects.map((d, i) => (
                  <div key={i} className="p-3 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 transition-colors">
                    <div className="flex items-center gap-2 mb-1">
                      <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      <span className="text-sm font-medium text-white">{d.project}</span>
                    </div>
                    {d.reason && <p className="text-xs text-slate-500 ml-6">{d.reason}</p>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-500 text-center py-4">No delayed projects</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Future Plan Records Table */}
      <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50">
        <div className="hidden md:grid grid-cols-12 gap-3 border-b border-slate-800 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <div className="col-span-2">Reporter</div>
          <div className="col-span-3">Note</div>
          <div className="col-span-2">Follow-up</div>
          <div className="col-span-2">Focus</div>
          <div className="col-span-2">Next Steps</div>
          <div className="col-span-1 text-right">AI</div>
        </div>

        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-12 gap-3 border-b border-slate-800/70 px-4 py-4">
              <Skeleton className="col-span-2 h-5 bg-slate-800" />
              <Skeleton className="col-span-3 h-5 bg-slate-800" />
              <Skeleton className="col-span-2 h-5 bg-slate-800" />
              <Skeleton className="col-span-2 h-5 bg-slate-800" />
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
              <div className="md:col-span-2 min-w-0">
                <p className="truncate text-sm font-medium text-white">{record.sender.displayName}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {formatDistanceToNow(new Date(record.createdAt), { addSuffix: true })}
                </p>
              </div>
              <div className="md:col-span-3 min-w-0">
                <p className="line-clamp-2 text-sm text-slate-300">{record.note}</p>
              </div>
              <div className="md:col-span-2 min-w-0">
                <p className="truncate text-sm text-blue-400">{record.followUpClient || '-'}</p>
              </div>
              <div className="md:col-span-2 min-w-0">
                <p className="truncate text-sm text-emerald-400">{record.focusService || '-'}</p>
              </div>
              <div className="md:col-span-2 min-w-0">
                <p className="truncate text-sm text-slate-400">{record.nextSteps || '-'}</p>
              </div>
              <div className="md:col-span-1 text-right text-xs text-slate-500">
                {Math.round(record.confidence * 100)}%
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
            <Lightbulb className="mb-3 h-9 w-9 text-slate-600" />
            <h3 className="text-lg font-medium text-slate-300">No future plans yet</h3>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              Send future plan reports via Telegram bot to see data here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
