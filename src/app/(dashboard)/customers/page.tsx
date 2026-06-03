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
import { customersApi } from '@/lib/api';
import { toast } from 'sonner';

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  inactive: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
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
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete all customers');
    },
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Customers</h1>
          <p className="text-sm text-gray-400 mt-1">Track customer follow-ups and history</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search customers..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 w-64 bg-black/20 border-gray-700"
            />
          </div>
          <AlertDialog>
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
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all customers?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete <strong>{data?.total ?? 0}</strong> customer
                  {(data?.total ?? 0) === 1 ? '' : 's'} and all related activity history.
                  Associated demand records will keep their data but lose the customer link.
                  This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
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
            <Card key={i} className="bg-gray-900/50 border-gray-800">
              <CardHeader className="pb-3">
                <Skeleton className="h-4 w-24" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-8 w-32 mb-2" />
                <Skeleton className="h-3 w-40" />
              </CardContent>
            </Card>
          ))
        ) : data?.customers?.length === 0 ? (
          <div className="col-span-full text-center py-12 text-gray-400">
            No customers found. Telegram messages will create customer records automatically.
          </div>
        ) : (
          data?.customers?.map((customer: any) => (
            <Card key={customer.id} className="bg-gray-900/50 border-gray-800 hover:border-gray-700 transition-colors relative group">
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
                        <CardTitle className="text-base truncate">{customer.name}</CardTitle>
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
                              className="p-2 rounded-md text-gray-500 hover:text-red-400 hover:bg-red-500/10 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-colors"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                              }}
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          }
                        />
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete {customer.name}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This will permanently delete the customer and all related activity history.
                              Associated demand records will keep their data but lose the customer link.
                              This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
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
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Phone className="w-3.5 h-3.5" />
                      {customer.phone}
                    </div>
                  )}
                  {customer.company && (
                    <div className="flex items-center gap-2 text-sm text-gray-400">
                      <Building className="w-3.5 h-3.5" />
                      {customer.company}
                    </div>
                  )}
                  <div className="flex items-center gap-4 pt-2 text-xs text-gray-500">
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
                    <div className="pt-2 border-t border-gray-800">
                      <p className="text-xs text-gray-400 line-clamp-2">
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