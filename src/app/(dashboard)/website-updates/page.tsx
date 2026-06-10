'use client';

import { useEffect, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { useWebsiteUpdates, useUpdateWebsiteUpdate } from '@/hooks/use-website-updates';
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
  Wrench,
  Search,
  ChevronLeft,
  ChevronRight,
  Globe,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Edit2,
  ExternalLink,
  MessageSquare,
  FileSpreadsheet,
  Clock,
  Bot,
  RefreshCw,
} from 'lucide-react';
import { WebsiteUpdate } from '@/lib/api';
import { useWebsiteUpdateRecommendations } from '@/hooks/use-website-updates';

export default function WebsiteUpdatesPage() {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'up_to_date' | 'pending_update' | 'in_progress'>('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  // Editing state for updating status/remark
  const [editingRecord, setEditingRecord] = useState<WebsiteUpdate | null>(null);
  const [editStatus, setEditStatus] = useState<string>('up_to_date');
  const [editRemark, setEditRemark] = useState<string>('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useWebsiteUpdates({
    page,
    limit,
    search: debouncedSearch || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
  });

  const updateMutation = useUpdateWebsiteUpdate();
  const { data: recsData, isLoading: recsLoading, refetch: recsRefetch, isFetching: recsFetching } = useWebsiteUpdateRecommendations();

  const stats = data?.stats || { total: 0, upToDate: 0, pendingUpdate: 0, inProgress: 0 };
  const records = data?.records || [];

  const handleEditClick = (record: WebsiteUpdate) => {
    setEditingRecord(record);
    setEditStatus(record.status);
    setEditRemark(record.remark || '');
  };

  const handleSaveEdit = async () => {
    if (!editingRecord) return;
    
    await updateMutation.mutateAsync({
      id: editingRecord.id,
      status: editStatus,
      remark: editRemark || null,
    });
    
    setEditingRecord(null);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'up_to_date':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/20 text-xs px-2.5 py-0.5 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-400 shrink-0" />
            Up to date
          </Badge>
        );
      case 'pending_update':
        return (
          <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/20 text-xs px-2.5 py-0.5 font-medium">
            <AlertCircle className="w-3.5 h-3.5 mr-1 text-red-400 shrink-0" />
            Pending Update
          </Badge>
        );
      case 'in_progress':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-xs px-2.5 py-0.5 font-medium">
            <Clock className="w-3.5 h-3.5 mr-1 text-amber-400 shrink-0" />
            In Progress
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="bg-slate-800 text-slate-400 border-slate-700 text-xs px-2.5 py-0.5 font-medium">
            Unknown
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          Website Updates & Maintenance
        </h1>
        <p className="text-slate-400">
          Monitor package subscriptions, business types, and change update status for active websites.
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Websites</CardTitle>
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
              <AlertCircle className="w-4 h-4 text-red-400" /> Pending Updates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-3xl font-bold text-red-400">{stats.pendingUpdate}</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 shadow-lg border-l-4 border-l-amber-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-amber-400 flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-amber-400" /> In Progress
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-3xl font-bold text-amber-400">{stats.inProgress}</div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800 shadow-lg border-l-4 border-l-emerald-500/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Up to Date
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16 bg-slate-800" />
            ) : (
              <div className="text-3xl font-bold text-emerald-400">{stats.upToDate}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* AI Insights Card */}
      <Card className="bg-slate-900 border-slate-800 shadow-lg">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <Bot className="w-5 h-5 text-indigo-400 animate-pulse" />
                🤖 AI Maintenance Insights
              </CardTitle>
              <CardDescription className="text-slate-400">
                Gemini AI-powered action recommendations for pending & in-progress sites
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
                  <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0 mt-0.5">
                    <Bot className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-200">{rec.websiteName}</p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{rec.insight}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-slate-500">
              <Bot className="w-8 h-8 text-slate-800 mx-auto mb-2" />
              <p className="text-sm font-medium">No pending maintenance actions</p>
              <p className="text-xs text-slate-600 mt-1">All websites are up to date — great work!</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Main Table Card */}
      <Card className="bg-slate-900 border-slate-800 shadow-xl">
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
            <div>
              <CardTitle className="text-white">Active Projects Directory</CardTitle>
              <CardDescription className="text-slate-400">
                Filter by maintenance status, search by domain, or manage update actions.
              </CardDescription>
            </div>

            {/* Filter controls */}
            <div className="flex flex-wrap gap-3 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <Input
                  placeholder="Search project, URL, package..."
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
                  value={statusFilter}
                  onValueChange={(val) => {
                    setStatusFilter((val as any) || 'all');
                    setPage(1);
                  }}
                >
                  <SelectTrigger className="bg-slate-800/50 border-slate-700 text-slate-300 min-w-42.5">
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-800 text-slate-300">
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
            <div className="min-w-250">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 border-b border-slate-800 px-6 py-3.5 text-xs font-semibold uppercase tracking-wider text-slate-500 bg-slate-900/35">
                <div className="col-span-3">Name / Business Type</div>
                <div className="col-span-3">Website Link</div>
                <div className="col-span-2">Package</div>
                <div className="col-span-2">Status</div>
                <div className="col-span-2">Remarks & Actions</div>
              </div>

              {/* Table Body */}
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-12 gap-4 border-b border-slate-800/70 px-6 py-4">
                    <Skeleton className="col-span-3 h-5 bg-slate-800" />
                    <Skeleton className="col-span-3 h-5 bg-slate-800" />
                    <Skeleton className="col-span-2 h-5 bg-slate-800" />
                    <Skeleton className="col-span-2 h-5 bg-slate-800" />
                    <Skeleton className="col-span-2 h-5 bg-slate-800" />
                  </div>
                ))
              ) : records.length ? (
                records.map((record) => {
                  return (
                    <div
                      key={record.id}
                      className="grid grid-cols-12 gap-4 border-b border-slate-800/50 px-6 py-4.5 items-center hover:bg-slate-900/30 transition-colors last:border-0"
                    >
                      {/* Name / Business Type */}
                      <div className="col-span-3 min-w-0">
                        <span className="text-sm font-semibold text-white block truncate" title={record.name}>
                          {record.name}
                        </span>
                        {record.businessType ? (
                          <span className="text-xs text-slate-400 block mt-0.5 truncate" title={record.businessType}>
                            {record.businessType}
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-600 block mt-0.5 italic">No Business Type</span>
                        )}
                      </div>

                      {/* Website Link */}
                      <div className="col-span-3 min-w-0">
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
                          <span className="text-xs text-slate-650 italic">No URL</span>
                        )}
                      </div>

                      {/* Package Name */}
                      <div className="col-span-2 min-w-0">
                        {record.packageName ? (
                          <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-xs px-2 py-0 truncate max-w-full">
                            {record.packageName}
                          </Badge>
                        ) : (
                          <span className="text-xs text-slate-600 italic">No Package Specified</span>
                        )}
                      </div>

                      {/* Status */}
                      <div className="col-span-2">
                        {getStatusBadge(record.status)}
                        <span className="text-[9px] text-slate-500 block mt-1">
                          Updated: {formatDistanceToNow(new Date(record.updatedAt), { addSuffix: true })}
                        </span>
                      </div>

                      {/* Remarks & Actions */}
                      <div className="col-span-2 flex items-center justify-between gap-3 min-w-0">
                        <div className="truncate flex-1">
                          {record.remark ? (
                            <p className="text-xs text-slate-400 truncate w-full flex items-center gap-1" title={record.remark}>
                              <MessageSquare className="w-3 h-3 text-slate-500 shrink-0" />
                              <span className="truncate">{record.remark}</span>
                            </p>
                          ) : (
                            <span className="text-[10px] text-slate-600 italic">No remarks</span>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditClick(record)}
                          className="h-8 w-8 text-slate-400 hover:text-white shrink-0 hover:bg-slate-800 rounded-lg"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
                  <FileSpreadsheet className="mb-4 h-12 w-12 text-slate-650" />
                  <h3 className="text-lg font-semibold text-slate-300">No website updates found</h3>
                  <p className="mt-1 max-w-sm text-sm text-slate-500">
                    Upload your Website Update List Excel sheet via Telegram to populate this dashboard.
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

      {/* Editing Dialog / Overlay Modal */}
      {editingRecord && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-lg rounded-xl overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200 p-6 space-y-4 text-slate-200">
            <div className="flex justify-between items-center border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Manage Maintenance: {editingRecord.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5 truncate max-w-100">
                  {editingRecord.url || 'No URL registered'}
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

            {/* Status Selection */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Update Status
              </label>
              <Select
                value={editStatus}
                onValueChange={(val) => setEditStatus(val || 'up_to_date')}
              >
                <SelectTrigger className="bg-slate-800 border-slate-700 text-white focus-visible:ring-indigo-500 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-800 text-slate-200">
                  <SelectItem value="up_to_date">Up to Date</SelectItem>
                  <SelectItem value="pending_update">Pending Update</SelectItem>
                  <SelectItem value="in_progress">In Progress</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Remarks Input */}
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Maintenance Notes / Remarks
              </label>
              <textarea
                value={editRemark}
                onChange={(e) => setEditRemark(e.target.value)}
                placeholder="Enter update tasks, details, or issues..."
                className="w-full h-24 bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm text-white focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-500"
              />
            </div>

            {/* Save Buttons */}
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
                {updateMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />
                )}
                Save Changes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
