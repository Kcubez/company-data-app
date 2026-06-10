'use client';

import { use, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNow, format } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
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
  ArrowLeft,
  Phone,
  Mail,
  Building,
  FileText,
  MessageSquare,
  Calendar,
  User,
  Clock,
  CheckCircle,
  AlertCircle,
  Send,
  Trash2,
} from 'lucide-react';
import { customersApi } from '@/lib/api';
import { toast } from 'sonner';

const statusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  contacted: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  quoted: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  pending: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  closed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

const actionIcons: Record<string, typeof CheckCircle> = {
  follow_up: User,
  demand_report: FileText,
  business_report: FileText,
  future_plan: AlertCircle,
  update: AlertCircle,
  contact: Phone,
};

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customersApi.get(id),
    refetchInterval: 5000,
    retry: false,
  });

  // If the customer disappears (deleted from another tab) or never existed,
  // send the user back to the list instead of showing a "not found" page.
  useEffect(() => {
    if (isError) {
      router.replace('/customers');
    }
  }, [isError, error, router]);

  const deleteCustomer = useMutation({
    mutationFn: () => customersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer deleted');
      router.push('/customers');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete customer');
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="bg-gray-900/50 border-gray-800">
            <CardHeader><Skeleton className="h-4 w-24" /></CardHeader>
            <CardContent><Skeleton className="h-24 w-full" /></CardContent>
          </Card>
          <div className="lg:col-span-2 space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Card key={i} className="bg-gray-900/50 border-gray-800">
                <CardContent className="pt-4"><Skeleton className="h-16 w-full" /></CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!data?.customer) {
    // Briefly shown while the redirect to /customers is in flight.
    return (
      <div className="p-6 text-center text-gray-400">Redirecting…</div>
    );
  }

  const { customer, timeline } = data;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/customers">
          <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-white">{customer.name}</h1>
          <p className="text-sm text-gray-400 mt-1">
            Customer since {format(new Date(customer.createdAt), 'MMM d, yyyy')}
          </p>
        </div>
        <Badge variant="outline" className={statusColors[customer.status] || statusColors.new}>
          {customer.status}
        </Badge>
        <AlertDialog>
          <AlertDialogTrigger
            render={
              <Button
                variant="ghost"
                size="sm"
                className="text-gray-400 hover:text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="w-4 h-4 mr-1" />
                Delete
              </Button>
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
                onClick={() => deleteCustomer.mutate()}
                disabled={deleteCustomer.isPending}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteCustomer.isPending ? 'Deleting…' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="bg-gray-900/50 border-gray-800">
          <CardHeader>
            <CardTitle className="text-base">Customer Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {customer.phone && (
              <div className="flex items-center gap-3 text-sm">
                <Phone className="w-4 h-4 text-gray-400" />
                <span>{customer.phone}</span>
              </div>
            )}
            {customer.email && (
              <div className="flex items-center gap-3 text-sm">
                <Mail className="w-4 h-4 text-gray-400" />
                <span>{customer.email}</span>
              </div>
            )}
            {customer.company && (
              <div className="flex items-center gap-3 text-sm">
                <Building className="w-4 h-4 text-gray-400" />
                <span>{customer.company}</span>
              </div>
            )}
            {customer.notes && (
              <div className="pt-3 border-t border-gray-800">
                <p className="text-xs text-gray-400">{customer.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-900/50 border-gray-800 lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="relative">
              <div className="absolute left-4 top-0 bottom-0 w-px bg-gray-800" />
              <div className="space-y-4">
                {timeline.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    No activity yet. Telegram messages will appear here.
                  </div>
                ) : (
                  timeline.map((item, index) => {
                    const Icon = item.type === 'activity'
                      ? (actionIcons[item.action || 'update'] || User)
                      : FileText;

                    return (
                      <div key={item.id} className="relative pl-10">
                        <div className={`absolute left-2.5 top-1 w-3 h-3 rounded-full border-2 ${
                          item.type === 'activity'
                            ? 'bg-blue-500 border-blue-400'
                            : 'bg-purple-500 border-purple-400'
                        }`} />

                        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-800">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Icon className={`w-4 h-4 ${
                                item.type === 'activity' ? 'text-blue-400' : 'text-purple-400'
                              }`} />
                              <span className="text-sm font-medium text-white">
                                {item.type === 'activity'
                                  ? item.action?.replace('_', ' ').toUpperCase()
                                  : item.reportType?.replace('_', ' ').toUpperCase()
                                }
                              </span>
                            </div>
                            <span className="text-xs text-gray-500">
                              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                            </span>
                          </div>

                          {item.type === 'demand' && (
                            <div className="mb-2">
                              {item.customerName && (
                                <p className="text-sm text-blue-400 mb-1">
                                  Customer: {item.customerName}
                                </p>
                              )}
                              <Badge variant="outline" className={`text-xs ${statusColors[item.status || 'new'] || statusColors.new}`}>
                                {item.status}
                              </Badge>
                            </div>
                          )}

                          <p className="text-sm text-gray-300 mb-2">
                            {item.type === 'activity' ? item.description : item.note}
                          </p>

                          {item.sender && (
                            <div className="flex items-center gap-1 text-xs text-gray-500">
                              <User className="w-3 h-3" />
                              {item.sender}
                              {item.senderId && (
                                <span className="text-gray-600">• {item.senderId}</span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}