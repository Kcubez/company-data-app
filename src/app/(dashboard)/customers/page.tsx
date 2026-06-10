'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
} from 'lucide-react';
import { customersApi, type Customer } from '@/lib/api';
import { toast } from 'sonner';

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  inactive: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
};

function useCustomers(params: { search?: string; page?: number; limit?: number; status?: string } = {}) {
  return useQuery({
    queryKey: ['customers', params],
    queryFn: () => customersApi.list(params),
    refetchInterval: 10000,
  });
}

export default function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data, isLoading } = useCustomers({
    search: debouncedSearch,
    page: 1,
    limit: 50,
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

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Customers</h1>
          <p className="text-sm text-slate-400 mt-1">Track customer follow-ups and history</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
            />
          </div>
          <AlertDialog open={isDeleteAllOpen} onOpenChange={setIsDeleteAllOpen}>
            <AlertDialogTrigger
              render={
                <button
                  type="button"
                  disabled={!data?.customers?.length}
                  className="inline-flex items-center gap-2 px-3 h-9 rounded-md text-sm border border-red-500/30 text-red-400 bg-red-500/5 hover:bg-red-500/15 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete All
                </button>
              }
            />
            <AlertDialogContent className="bg-slate-900 border-slate-800 text-slate-200">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all customers?</AlertDialogTitle>
                <AlertDialogDescription className="text-slate-400">
                  This will permanently delete <strong>{data?.total ?? 0}</strong> customer
                  {(data?.total ?? 0) === 1 ? '' : 's'} and all related activity history.
                  Associated demand records will keep their data but lose the customer link.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="border-slate-700 text-slate-300">Cancel</AlertDialogCancel>
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="bg-slate-900 border-slate-800">
              <CardHeader className="pb-3">
                <Skeleton className="h-4 w-24 bg-slate-800" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2 bg-slate-800" />
                <Skeleton className="h-3 w-40 bg-slate-800" />
              </CardContent>
            </Card>
          ))
        ) : data?.customers?.length === 0 ? (
          <div className="col-span-full text-center py-12 text-slate-400">
            No customers found. Telegram messages will create customer records automatically.
          </div>
        ) : (
          data?.customers?.map((customer: Customer) => (
            <Card key={customer.id} className="bg-slate-900 border-slate-800 hover:border-slate-700 transition-colors relative group">
              <Link href={`/customers/${customer.id}`} className="block">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar className="w-10 h-10 bg-blue-500/20 text-blue-400 shrink-0">
                        <AvatarFallback className="bg-blue-500/20 text-blue-400 text-sm">
                          {customer.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <CardTitle className="text-base truncate text-white">{customer.name}</CardTitle>
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
                              className="p-2 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-colors"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          }
                        />
                        <AlertDialogContent className="bg-slate-900 border-slate-800 text-slate-200">
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
                            <AlertDialogDescription className="text-slate-400">
                              This will permanently delete the customer and all related activity history.
                              Associated demand records will keep their data but lose the customer link.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel className="border-slate-700 text-slate-300">Cancel</AlertDialogCancel>
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
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Phone className="w-3.5 h-3.5" />
                      {customer.phone}
                    </div>
                  )}
                  {customer.company && (
                    <div className="flex items-center gap-2 text-sm text-slate-400">
                      <Building className="w-3.5 h-3.5" />
                      {customer.company}
                    </div>
                  )}
                  <div className="flex items-center gap-4 pt-2 text-xs text-slate-500">
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
                    <div className="pt-2 border-t border-slate-800">
                      <p className="text-xs text-slate-400 line-clamp-2">
                        <span className="text-blue-400">{customer.activities[0].sender?.displayName || 'Unknown'}</span>
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
    </div>
  );
}