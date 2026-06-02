'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Search,
  Phone,
  Building,
  MessageSquare,
  ChevronRight,
  Calendar,
} from 'lucide-react';
import { customersApi } from '@/lib/api';

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
            <Link key={customer.id} href={`/customers/${customer.id}`}>
              <Card className="bg-gray-900/50 border-gray-800 hover:border-gray-700 transition-colors cursor-pointer">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Avatar className="w-10 h-10 bg-blue-500/20 text-blue-400">
                        <AvatarFallback className="bg-blue-500/20 text-blue-400 text-sm">
                          {customer.name.charAt(0)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <CardTitle className="text-base">{customer.name}</CardTitle>
                        <Badge variant="outline" className={`mt-1 text-xs ${statusColors[customer.status] || statusColors.active}`}>
                          {customer.status}
                        </Badge>
                      </div>
                    </div>
                    <ChevronRight className="w-5 h-5 text-gray-500" />
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
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}