'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Search,
  Phone,
  Building,
  MessageSquare,
  ChevronRight,
  Calendar,
  Trash2,
  ChevronLeft,
  Users,
} from 'lucide-react';
import { customersApi, type Customer } from '@/lib/api';
import { toast } from 'sonner';
import { useDemandRecords, useDemandRecordStats } from '@/hooks/use-demand-records';

const PAGE_SIZE = 10;

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  inactive: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
};

function useCustomers(params: { search?: string; page?: number; limit?: number; status?: string } = {}) {
  return useQuery({
    queryKey: ['customers', params],
    queryFn: () => customersApi.list(params),
    placeholderData: (prev) => prev,
    refetchInterval: 10000,
  });
}

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(1);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // reset to page 1 on new search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading, isFetching } = useCustomers({
    search: debouncedSearch,
    page,
    limit: PAGE_SIZE,
  });
  const { data: demandStats, isLoading: demandStatsLoading } = useDemandRecordStats();
  const { data: demandRecordsData, isLoading: demandRecordsLoading } = useDemandRecords({
    page: 1,
    limit: 10,
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => customersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete customer');
    },
  });

  const deleteAllCustomers = useMutation({
    mutationFn: () => customersApi.deleteAll(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success(`${res.count} customer${res.count === 1 ? '' : 's'} deleted`);
      setIsDeleteAllOpen(false);
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete all customers');
    },
  });

  const totalPages = data?.totalPages ?? 1;
  const currentCustomers = data?.customers ?? [];
  const activeCustomers = currentCustomers.filter((customer) => customer.status === 'active').length;
  const totalDemandRecords = demandStats?.totalRecords ?? 0;
  const highPotential = demandStats?.priority.high ?? 0;
  const demandLeads = demandRecordsData?.records ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold  text-foreground font-heading">Customer Service</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customer directory, demand leads, and satisfaction metrics
            {data?.total ? (
              <span className="ml-2 text-xs font-mono text-blue-600 dark:text-blue-400">
                ({data.total} total)
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64 bg-card/50 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-ring"
            />
          </div>
          <AlertDialog open={isDeleteAllOpen} onOpenChange={setIsDeleteAllOpen}>
            <AlertDialogTrigger
              render={
                <button
                  type="button"
                  disabled={!data?.customers?.length}
                  className="inline-flex items-center gap-2 px-3 h-9 rounded-md text-sm border border-red-500/30 text-red-600 dark:text-red-400 bg-red-500/5 hover:bg-red-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All
                </button>
              }
            />
            <AlertDialogContent className="bg-card border-border text-foreground">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all customers?</AlertDialogTitle>
                <AlertDialogDescription className="text-muted-foreground">
                  This will permanently delete <strong>{data?.total ?? 0}</strong> customer
                  {(data?.total ?? 0) === 1 ? '' : 's'} and all related activity history.
                  Associated demand records will keep their data but lose the customer link.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-border text-foreground">Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => deleteAllCustomers.mutate()}
                  disabled={deleteAllCustomers.isPending}
                  className="bg-red-600 hover:bg-red-700 text-white"
                >
                  {deleteAllCustomers.isPending ? 'Deleting…' : 'Delete All'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Demands', value: totalDemandRecords, color: 'text-slate-900 dark:text-slate-100', loading: demandStatsLoading },
          { label: 'High Potential', value: highPotential, color: 'text-blue-600 dark:text-blue-400', loading: demandStatsLoading, accent: 'border-l-4 border-l-blue-500' },
          { label: 'Total Customers', value: data?.total ?? 0, color: 'text-emerald-600 dark:text-emerald-400', loading: isLoading, accent: 'border-l-4 border-l-emerald-500' },
          { label: 'Active On Page', value: activeCustomers, color: 'text-slate-900 dark:text-slate-100', loading: isLoading },
        ].map((item) => (
          <Card key={item.label} className={`bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl ${item.accent ?? ''}`}>
            <CardContent className="p-6 h-32 flex flex-col justify-center">
              <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">{item.label}</p>
              {item.loading ? <Skeleton className="h-8 w-16" /> : <h3 className={`text-2xl font-black ${item.color}`}>{item.value.toLocaleString()}</h3>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-white dark:bg-card border-2 border-red-300 border-l-8 border-l-red-500 rounded-xl shadow-sm">
          <CardContent className="p-5">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-2">Critical Phone Missing Alert</h4>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              High potential leads should include phone numbers before handoff. Keep checking demand lead records for missing contact details.
            </p>
          </CardContent>
        </Card>
        <Card className="bg-white dark:bg-card border-2 border-emerald-300 border-l-8 border-l-emerald-500 rounded-xl shadow-sm">
          <CardContent className="p-5">
            <h4 className="font-bold text-slate-900 dark:text-slate-100 mb-2">Follow-up Quality</h4>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Use the paginated customer directory below for repeated follow-up, service history, and customer activity review.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card className="bg-white dark:bg-card border-2 border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <CardTitle className="text-lg font-extrabold text-slate-900 dark:text-slate-100">
              Purchased Customers Directory
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-4 text-left font-extrabold">Customer</th>
                    <th className="px-5 py-4 text-left font-extrabold">Company</th>
                    <th className="px-5 py-4 text-left font-extrabold">Contact</th>
                    <th className="px-5 py-4 text-left font-extrabold">Records</th>
                    <th className="px-5 py-4 text-left font-extrabold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {isLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index}>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-12" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-5 w-16" /></td>
                      </tr>
                    ))
                  ) : currentCustomers.length > 0 ? (
                    currentCustomers.map((customer) => (
                      <tr key={customer.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                        <td className="px-5 py-4">
                          <Link href={`/customers/${customer.id}`} className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600">
                            {customer.name}
                          </Link>
                        </td>
                        <td className="px-5 py-4 text-slate-600 dark:text-slate-400">{customer.company || '-'}</td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-700 dark:text-slate-300">{customer.phone || 'No phone'}</td>
                        <td className="px-5 py-4 font-bold text-slate-900 dark:text-slate-100">
                          {customer._count?.demandRecords || 0}
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant="outline" className={`text-xs ${statusColors[customer.status] || statusColors.active}`}>
                            {customer.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="px-5 py-10 text-center text-sm text-slate-500">
                        No purchased customers available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-white dark:bg-card border-2 border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-200 dark:border-slate-800 pb-4">
            <CardTitle className="text-lg font-extrabold text-slate-900 dark:text-slate-100">
              Demand Leads Data
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-4 text-left font-extrabold">Date</th>
                    <th className="px-5 py-4 text-left font-extrabold">Lead</th>
                    <th className="px-5 py-4 text-left font-extrabold">Service</th>
                    <th className="px-5 py-4 text-left font-extrabold">Priority</th>
                    <th className="px-5 py-4 text-left font-extrabold">Follow-up</th>
                    <th className="px-5 py-4 text-left font-extrabold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                  {demandRecordsLoading ? (
                    Array.from({ length: 5 }).map((_, index) => (
                      <tr key={index}>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-32" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-28" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-5 w-16" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-4 w-20" /></td>
                        <td className="px-5 py-4"><Skeleton className="h-5 w-16" /></td>
                      </tr>
                    ))
                  ) : demandLeads.length > 0 ? (
                    demandLeads.map((lead) => (
                      <tr key={lead.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40">
                        <td className="px-5 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {format(new Date(lead.createdAt), 'yyyy-MM-dd')}
                        </td>
                        <td className="px-5 py-4 font-bold text-slate-900 dark:text-slate-100">
                          {lead.customerId ? (
                            <Link href={`/customers/${lead.customerId}`} className="hover:text-blue-600">
                              {lead.customerName || 'Unknown'}
                            </Link>
                          ) : (
                            lead.customerName || 'Unknown'
                          )}
                        </td>
                        <td className="px-5 py-4 text-slate-600 dark:text-slate-400">{lead.serviceName || '-'}</td>
                        <td className="px-5 py-4">
                          <Badge variant="outline" className="text-xs uppercase">
                            {lead.priority}
                          </Badge>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                          {lead.followUpDate ? format(new Date(lead.followUpDate), 'yyyy-MM-dd') : '-'}
                        </td>
                        <td className="px-5 py-4">
                          <Badge variant="outline" className="text-xs">
                            {lead.status}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                        No demand leads available yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="glass-card border-border/70">
              <CardHeader className="pb-3">
                <Skeleton className="h-4 w-24 bg-muted" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2 bg-muted" />
                <Skeleton className="h-3 w-40 bg-muted" />
              </CardContent>
            </Card>
          ))
        ) : data?.customers?.length === 0 ? null : (
          data?.customers?.map((customer: Customer) => (
            <Card key={customer.id} className="glass-card glass-card-hover border-border/70 transition-colors relative group">
              <Link href={`/customers/${customer.id}`} className="block">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="w-10 h-10 bg-blue-500/20 text-blue-600 dark:text-blue-400 shrink-0">
                        <AvatarFallback className="bg-blue-500/20 text-blue-600 dark:text-blue-400 text-sm">
                          {customer.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate text-foreground">{customer.name}</CardTitle>
                        <Badge variant="outline" className={`mt-1 text-xs ${statusColors[customer.status] || statusColors.active}`}>
                          {customer.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <button
                              type="button"
                              aria-label="Delete customer"
                              className="p-2 rounded-md text-slate-500 hover:text-red-600 dark:hover:text-red-400 dark:text-red-600 hover:bg-red-500/10 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-colors"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          }
                        />
                        <AlertDialogContent className="bg-card border-border text-foreground">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
                            <AlertDialogDescription className="text-muted-foreground">
                              This will permanently delete the customer and all related activity history.
                              Associated demand records will keep their data but lose the customer link.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="border-border text-foreground">Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteCustomer.mutate(customer.id)}
                              disabled={deleteCustomer.isPending}
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              {deleteCustomer.isPending ? 'Deleting…' : 'Delete'}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                      <ChevronRight className="w-5 h-5 text-slate-500" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Phone className="w-3.5 h-3.5" />
                      {customer.phone}
                    </div>
                  )}
                  {customer.company && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Building className="w-3.5 h-3.5" />
                      {customer.company}
                    </div>
                  )}
                  <div className="flex items-center gap-4 pt-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {customer._count?.demandRecords || 0} records
                    </div>
                    {customer.activities?.[0] && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDistanceToNow(new Date(customer.activities[0].createdAt), { addSuffix: true })}
                      </div>
                    )}
                  </div>
                  {customer.activities?.[0] && (
                    <div className="pt-2 border-t border-border">
                      <p className="text-xs text-muted-foreground line-clamp-2">
                        <span className="text-blue-600 dark:text-blue-400">{customer.activities[0].sender?.displayName || 'Unknown'}</span>
                        {' - '}
                        {customer.activities[0].description}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Link>
            </Card>
          ))
        )}
      </div>

      {/* Pagination */}
      {!isLoading && totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-muted-foreground font-mono">
            Page <span className="font-bold text-foreground">{page}</span> of{' '}
            <span className="font-bold text-foreground">{totalPages}</span>
            {isFetching && !isLoading && (
              <span className="ml-2 text-blue-500 animate-pulse">Refreshing…</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="h-8 px-3 text-xs border-border"
            >
              <ChevronLeft className="w-3.5 h-3.5 mr-1" />
              Prev
            </Button>

            {/* Page number buttons — show up to 5 around current page */}
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 5) }).map((_, i) => {
                let pageNum: number;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <Button
                    key={pageNum}
                    variant={pageNum === page ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setPage(pageNum)}
                    className={`h-8 w-8 p-0 text-xs ${
                      pageNum === page
                        ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
                        : 'border-border text-muted-foreground'
                    }`}
                  >
                    {pageNum}
                  </Button>
                );
              })}
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="h-8 px-3 text-xs border-border"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* No results when total is 0 */}
      {!isLoading && data?.total === 0 && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
          <Users className="w-10 h-10 opacity-30" />
          <p className="text-sm font-medium">
            {debouncedSearch ? `No customers match "${debouncedSearch}"` : 'No customers yet'}
          </p>
          <p className="text-xs opacity-70">Telegram demand messages will create customer records automatically.</p>
        </div>
      )}
    </div>
  );
}
