'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDateFilter } from '@/hooks/use-date-filter';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { format } from 'date-fns';
import { Card, CardContent, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Search,
  Phone,
  MessageSquare,
  ChevronRight,
  Trash2,
  ChevronLeft,
  Users,
  Edit2,
  Plus,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Bot,
  BarChart3,
  Crown,
  RotateCcw,
  HeartPulse,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { customersApi, type Customer, type CustomerAnalyticsMetric, type DemandRecord } from '@/lib/api';
import { clearListQueryData, removeListItemQueryData } from '@/lib/query-cache';
import { toast } from 'sonner';
import { formatPhoneNumber } from '@/lib/utils';
import {
  useDemandRecords,
  useDemandRecordStats,
  useCreateDemandRecord,
  useUpdateDemandRecord,
  useDeleteDemandRecord,
} from '@/hooks/use-demand-records';
import { ModalPortal } from '@/components/ui/modal-portal';
import { useCustomerAnalytics } from '@/hooks/use-customer-analytics';

const PAGE_SIZE = 10;

const statusColors: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
  inactive: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
  pending: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
};

const priorityColors: Record<string, string> = {
  high: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20 font-bold',
  medium: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 font-bold',
  low: 'bg-slate-500/10 text-muted-foreground border-slate-500/20',
};

const leadStatusColors: Record<string, string> = {
  new: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  contacted: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
  quoted: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  pending: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900',
  closed: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
};

function useCustomers(params: { search?: string; page?: number; limit?: number; status?: string; dateFrom?: string; dateTo?: string; reportType?: string } = {}) {
  return useQuery({
    queryKey: ['customers', params],
    queryFn: () => customersApi.list(params),
    placeholderData: (prev) => prev,
    refetchInterval: 10000,
  });
}

function CustomersPageContent() {
  const router = useRouter();
  const queryClient = useQueryClient();

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
  } = useDateFilter('customer_filter');

  const searchParams = useSearchParams();
  const initialCustomerSearch = searchParams.get('customerSearch') || '';
  const initialDemandSearch = searchParams.get('search') || searchParams.get('demandSearch') || '';
  const initialFollowUpStatus = searchParams.get('followUpStatus') || 'all';

  // Purchased Customers Pagination and Search
  const [customerSearch, setCustomerSearch] = useState(initialCustomerSearch);
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState(initialCustomerSearch);
  const [customerPage, setCustomerPage] = useState(1);

  // Purchase Records Pagination and Search
  const [demandSearch, setDemandSearch] = useState(initialDemandSearch);
  const [debouncedDemandSearch, setDebouncedDemandSearch] = useState(initialDemandSearch);
  const [followUpFilter, setFollowUpFilter] = useState<string>(initialFollowUpStatus);
  const [demandPage, setDemandPage] = useState(1);
  const [lastUrlFilters, setLastUrlFilters] = useState(
    () => `${initialCustomerSearch}:${initialDemandSearch}:${initialFollowUpStatus}`,
  );
  const [showAiSuggestions, setShowAiSuggestions] = useState(false);
  const [showBehaviorAnalysis, setShowBehaviorAnalysis] = useState(false);

  const urlCustomerSearch = searchParams.get('customerSearch') || '';
  const urlDemandSearch = searchParams.get('search') || searchParams.get('demandSearch') || '';
  const urlFollowUpStatus = searchParams.get('followUpStatus') || 'all';
  const urlFilters = `${urlCustomerSearch}:${urlDemandSearch}:${urlFollowUpStatus}`;
  if (lastUrlFilters !== urlFilters) {
    setLastUrlFilters(urlFilters);
    setCustomerSearch(urlCustomerSearch);
    setDebouncedCustomerSearch(urlCustomerSearch);
    setDemandSearch(urlDemandSearch);
    setDebouncedDemandSearch(urlDemandSearch);
    setFollowUpFilter(urlFollowUpStatus);
    setCustomerPage(1);
    setDemandPage(1);
  }

  useEffect(() => {
    const followUp = searchParams.get('followUpStatus');
    if (followUp && followUp !== 'all') {
      const timer = setTimeout(() => {
        const element = document.getElementById('demand-leads-section');
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

  // Modals Open/Prefill State
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const [customerForm, setCustomerForm] = useState({
    name: "",
    company: "",
    phone: "",
    email: "",
    status: "active",
    notes: "",
  });

  const [editingLead, setEditingLead] = useState<DemandRecord | null>(null);
  const [isCreatingLead, setIsCreatingLead] = useState(false);
  const [leadForm, setLeadForm] = useState({
    customerName: "",
    customerPhone: "",
    customerCompany: "",
    serviceName: "",
    serviceAmount: "",
    serviceQty: "1",
    followUpDate: "",
    priority: "medium",
    status: "new",
    note: "",
  });

  // Delete Dialog States
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [leadToDelete, setLeadToDelete] = useState<DemandRecord | null>(null);
  const [isDeleteAllOpen, setIsDeleteAllOpen] = useState(false);
  const [deleteAllConfirmText, setDeleteAllConfirmText] = useState('');
  const [customerDeleteConfirmText, setCustomerDeleteConfirmText] = useState('');
  const [leadDeleteConfirmText, setLeadDeleteConfirmText] = useState('');

  // Debounce effects
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedCustomerSearch(customerSearch);
      setCustomerPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedDemandSearch(demandSearch);
      setDemandPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [demandSearch]);

  const [lastDateFilter, setLastDateFilter] = useState(() => `${period}:${month}:${day}:${year}:${customFrom}:${customTo}`);
  const dateFilter = `${period}:${month}:${day}:${year}:${customFrom}:${customTo}`;
  if (lastDateFilter !== dateFilter) {
    setLastDateFilter(dateFilter);
    setCustomerPage(1);
    setDemandPage(1);
  }

  // Queries
  const { data: customerData, isLoading: customerLoading } = useCustomers({
    search: debouncedCustomerSearch,
    page: customerPage,
    limit: PAGE_SIZE,
    dateFrom,
    dateTo,
    reportType: 'customer_service',
  });

  const { data: demandStats, isLoading: demandStatsLoading } = useDemandRecordStats({ dateFrom, dateTo });
  const { data: customerAnalytics, isLoading: customerAnalyticsLoading } = useCustomerAnalytics({ dateFrom, dateTo });

  const { data: demandData, isLoading: demandLoading } = useDemandRecords({
    page: demandPage,
    limit: PAGE_SIZE,
    search: debouncedDemandSearch || undefined,
    dateFrom,
    dateTo,
    followUpStatus: followUpFilter === 'all' ? undefined : followUpFilter,
    reportType: 'customer_service',
  });

  const { data: dashboardStats } = useQuery({
    queryKey: ['dashboard-stats-cs', period, month, day, year, customFrom, customTo],
    queryFn: async () => {
      const params = new URLSearchParams({ period, month: String(month), day: String(day), year: String(year) });
      if (period === 'custom') {
        params.set('from', customFrom);
        params.set('to', customTo);
      }
      const res = await fetch(`/api/dashboard/stats?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 15000,
  });

  // Mutations
  const createCustomerMutation = useMutation({
    mutationFn: (data: Partial<Customer>) => customersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer created successfully');
      setIsCreatingCustomer(false);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to create customer');
    }
  });

  const updateCustomerMutation = useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<Customer>) => customersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      toast.success('Customer updated successfully');
      setEditingCustomer(null);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update customer');
    }
  });

  const deleteCustomer = useMutation({
    mutationFn: (id: string) => customersApi.delete(id),
    onSuccess: (_res, id) => {
      removeListItemQueryData(queryClient, ['customers'], 'customers', id);
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['demand-records'] });
      queryClient.invalidateQueries({ queryKey: ['demand-record-stats'] });
      toast.success('Customer moved to Trash');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete customer');
    },
  });

  const deleteAllCustomers = useMutation({
    mutationFn: (params: { dateFrom?: string; dateTo?: string }) => customersApi.deleteAll(params),
    onSuccess: (res) => {
      clearListQueryData(queryClient, ['customers'], 'customers');
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['trash'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['demand-records'] });
      queryClient.invalidateQueries({ queryKey: ['demand-record-stats'] });
      toast.success(`${res.count} customer${res.count === 1 ? '' : 's'} moved to Trash`);
      setIsDeleteAllOpen(false);
      setDeleteAllConfirmText('');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to delete all customers');
    },
  });

  const createLeadMutation = useCreateDemandRecord();
  const updateLeadMutation = useUpdateDemandRecord();
  const deleteLeadMutation = useDeleteDemandRecord();

  // Handlers for Save
  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name.trim()) {
      toast.error("Name is required");
      return;
    }
    const payload = {
      name: customerForm.name.trim(),
      company: customerForm.company.trim() || null,
      phone: customerForm.phone.trim() || null,
      email: customerForm.email.trim() || null,
      status: customerForm.status,
      notes: customerForm.notes.trim() || null,
    };
    if (editingCustomer) {
      await updateCustomerMutation.mutateAsync({
        id: editingCustomer.id,
        ...payload,
      });
    } else {
      await createCustomerMutation.mutateAsync(payload);
    }
  };

  const handleSaveLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leadForm.customerName.trim()) {
      toast.error("Lead name is required");
      return;
    }
    const payload = {
      customerName: leadForm.customerName.trim(),
      customerPhone: leadForm.customerPhone.trim() || null,
      customerCompany: leadForm.customerCompany.trim() || null,
      serviceName: leadForm.serviceName.trim() || null,
      serviceAmount: leadForm.serviceAmount ? parseFloat(leadForm.serviceAmount) : null,
      serviceQty: leadForm.serviceQty ? parseInt(leadForm.serviceQty) : 1,
      followUpDate: leadForm.followUpDate || null,
      priority: leadForm.priority as "high" | "medium" | "low",
      status: leadForm.status,
      note: leadForm.note.trim() || "",
      reportType: "customer_service",
    };
    if (editingLead) {
      await updateLeadMutation.mutateAsync({
        id: editingLead.id,
        ...payload,
      });
      setEditingLead(null);
    } else {
      await createLeadMutation.mutateAsync(payload);
      setIsCreatingLead(false);
    }
  };

  // Prefill Functions
  const openEditCustomer = (customer: Customer) => {
    setEditingCustomer(customer);
    setCustomerForm({
      name: customer.name,
      company: customer.company || "",
      phone: customer.phone || "",
      email: customer.email || "",
      status: customer.status,
      notes: customer.notes || "",
    });
  };

  const openCreateCustomer = () => {
    setIsCreatingCustomer(true);
    setCustomerForm({
      name: "",
      company: "",
      phone: "",
      email: "",
      status: "active",
      notes: "",
    });
  };

  const openEditLead = (lead: DemandRecord) => {
    setEditingLead(lead);
    setLeadForm({
      customerName: lead.customerName || "",
      customerPhone: lead.customer?.phone || "",
      customerCompany: lead.customer?.company || "",
      serviceName: lead.serviceName || "",
      serviceAmount: lead.serviceAmount ? String(lead.serviceAmount) : "",
      serviceQty: lead.serviceQty ? String(lead.serviceQty) : "1",
      followUpDate: lead.followUpDate ? lead.followUpDate.slice(0, 10) : "",
      priority: lead.priority || "medium",
      status: lead.status || "new",
      note: lead.note || "",
    });
  };

  const openCreateLead = () => {
    setIsCreatingLead(true);
    setLeadForm({
      customerName: "",
      customerPhone: "",
      customerCompany: "",
      serviceName: "",
      serviceAmount: "",
      serviceQty: "1",
      followUpDate: "",
      priority: "medium",
      status: "new",
      note: "",
    });
  };

  // Calculations for metric cards
  const totalPurchaseRecords = demandStats?.totalPurchaseRecords ?? 0;
  const pendingPurchaseRecords = demandStats?.pendingPurchaseRecords ?? 0;
  const purchaseCustomers = demandStats?.uniquePurchaseCustomers ?? customerData?.total ?? 0;
  const avgSpending = dashboardStats?.totalCustomers > 0 
    ? (dashboardStats?.totalAmountSold / dashboardStats?.totalCustomers) 
    : 0;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Page Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border pb-5">
        <div>
          <h1 className="text-3xl font-bold text-foreground font-heading">Customer Service</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Customer directory, demand leads, and satisfaction metrics.
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

          <AlertDialog open={isDeleteAllOpen} onOpenChange={(open) => {
            setIsDeleteAllOpen(open);
            if (!open) setDeleteAllConfirmText('');
          }}>
            <button
              type="button"
              disabled={!customerData?.customers?.length}
              onClick={() => {
                setDeleteAllConfirmText('');
                setIsDeleteAllOpen(true);
              }}
              className="inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/5 px-3 text-sm font-semibold text-red-600 shadow-sm transition-colors hover:bg-red-500/15 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400"
            >
              <Trash2 className="w-4 h-4" />
              Delete All Clients
            </button>
          <AlertDialogContent className="bg-card border-border text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete customers for selected period?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                This will move <strong>{customerData?.total ?? 0}</strong> customer(s) from <strong>{dateFrom}</strong> to <strong>{dateTo}</strong> to Trash.
                Related activity history stays linked, and admins can restore these customers later.
              </AlertDialogDescription>
            </AlertDialogHeader>
             <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Type confirm to move these customers to Trash</label>
              <Input
                value={deleteAllConfirmText}
                onChange={(event) => setDeleteAllConfirmText(event.target.value)}
                disabled={deleteAllCustomers.isPending}
                placeholder="confirm"
                className="h-10 font-mono"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border text-foreground">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteAllCustomers.mutate({ dateFrom, dateTo })}
                disabled={deleteAllCustomers.isPending || deleteAllConfirmText.toLowerCase() !== 'confirm'}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {deleteAllCustomers.isPending ? 'Deleting…' : 'Move to Trash'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: 'Purchase Records', value: totalPurchaseRecords, color: 'text-slate-900 dark:text-slate-100', loading: demandStatsLoading, icon: MessageSquare, accent: 'border-l-4 border-l-slate-500' },
          { label: 'Pending Purchases', value: pendingPurchaseRecords, color: 'text-blue-600 dark:text-blue-400', loading: demandStatsLoading, accent: 'border-l-4 border-l-blue-500', icon: AlertTriangle },
          { label: 'Purchase Customers', value: purchaseCustomers, color: 'text-emerald-600 dark:text-emerald-400', loading: demandStatsLoading, accent: 'border-l-4 border-l-emerald-500', icon: Users },
          { label: 'Avg Spending Value', value: avgSpending, displayVal: Math.round(avgSpending).toLocaleString(), suffix: 'MMK', color: 'text-slate-900 dark:text-slate-100', loading: !dashboardStats, icon: DollarSign, accent: 'border-l-4 border-l-amber-500' },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.label} className={`bg-card border-2 border-slate-200 dark:border-slate-800 shadow-sm rounded-xl cursor-pointer ${item.accent}`}>
              <CardContent className="p-6 h-32 flex flex-col justify-center">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-extrabold text-slate-500 uppercase tracking-wider mb-2">{item.label}</p>
                    {item.loading ? (
                      <Skeleton className="h-8 w-16 bg-muted" />
                    ) : (
                      <h3 className={`flex items-baseline gap-1.5 text-2xl font-black ${item.color} tracking-tight`}>
                        <span>{item.displayVal ?? item.value.toLocaleString()}</span>
                        {item.suffix && (
                          <span className="text-xs font-bold text-slate-400">{item.suffix}</span>
                        )}
                      </h3>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-900 flex items-center justify-center text-slate-400">
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>      {/* Intelligence Cards */}

      {/* Customer analytics — spend is scoped to the selected date range; LTV is all-time. */}
      <Card id="customer-value-frequency" className="overflow-hidden rounded-xl border-2 border-slate-200 shadow-sm dark:border-slate-800">
        <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 p-5 dark:border-slate-800 dark:bg-slate-950/30 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground"><BarChart3 className="h-4 w-4 text-sky-600" />Customer Value &amp; Frequency</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Top and bottom 20 customers are ranked by selected-period spending. Lifetime value is calculated from all customer history.</p>
          </div>
          <Badge variant="outline" className="w-fit border-slate-300 bg-card text-xs font-semibold">{customerAnalytics?.summary.totalCustomers ?? 0} active customers</Badge>
        </div>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <CustomerMetricCard label="Top 20 average spend" value={customerAnalytics?.summary.top20AverageSpend ?? 0} icon={Crown} tone="border-l-amber-500" loading={customerAnalyticsLoading} />
            <CustomerMetricCard label="Bottom 20 average spend" value={customerAnalytics?.summary.bottom20AverageSpend ?? 0} icon={RotateCcw} tone="border-l-slate-500" loading={customerAnalyticsLoading} />
            <CustomerMetricCard label="Average lifetime value" value={customerAnalytics?.summary.averageLifetimeValue ?? 0} icon={HeartPulse} tone="border-l-emerald-500" loading={customerAnalyticsLoading} />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <CustomerRanking title="Top 20 customers" items={customerAnalytics?.top20 ?? []} loading={customerAnalyticsLoading} accent="text-amber-700 dark:text-amber-300" />
            <CustomerRanking title="Bottom 20 customers" items={customerAnalytics?.bottom20 ?? []} loading={customerAnalyticsLoading} accent="text-slate-700 dark:text-slate-300" />
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 border-sky-200 bg-sky-50/30 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/15">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground"><Bot className="h-4 w-4 text-sky-600" />Customer Behavior Analysis</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Analyzes customer behavior and provides insights into customer actions.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowBehaviorAnalysis((visible) => !visible)} className="shrink-0 border-border bg-card text-foreground hover:bg-muted/50">
            {showBehaviorAnalysis ? 'Hide analysis' : 'View analysis'}
            {showBehaviorAnalysis ? <ChevronUp className="ml-1.5 h-4 w-4" /> : <ChevronDown className="ml-1.5 h-4 w-4" />}
          </Button>
        </CardContent>
        {showBehaviorAnalysis && <CardContent className="border-t border-sky-200 p-5 dark:border-sky-900/60">
          {customerAnalyticsLoading ? <div className="grid grid-cols-1 gap-4 md:grid-cols-2"><Skeleton className="h-32 rounded-xl animate-pulse" /><Skeleton className="h-32 rounded-xl animate-pulse" /></div> : customerAnalytics?.recommendations.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{customerAnalytics.recommendations.map((insight) => {
              const isWarning = insight.tone === 'warning';
              const isSuccess = insight.tone === 'success';
              const InsightIcon = isWarning ? AlertTriangle : isSuccess ? CheckCircle2 : Bot;
              return <Card key={insight.title} className={`bg-white dark:bg-card border-2 rounded-xl shadow-sm flex flex-col justify-between ${isWarning ? 'border-amber-300 border-l-8 border-l-amber-500' : isSuccess ? 'border-emerald-300 border-l-8 border-l-emerald-500' : 'border-sky-300 border-l-8 border-l-sky-500'}`}><CardContent className="p-5 flex flex-col h-full justify-between"><div><div className="mb-2 flex items-center gap-3"><InsightIcon className={`h-5 w-5 shrink-0 ${isWarning ? 'text-amber-600' : isSuccess ? 'text-emerald-600' : 'text-sky-600'}`} /><h4 className="font-bold text-slate-900 dark:text-slate-100">{insight.title}</h4></div><p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">{insight.message}</p></div><div className="mt-3.5"><Button size="sm" onClick={() => document.getElementById('customer-value-frequency')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className={`${isWarning ? 'bg-amber-500 hover:bg-amber-600' : isSuccess ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-sky-600 hover:bg-sky-700'} h-8 rounded-lg border-none px-4 text-xs font-bold text-white shadow-sm transition cursor-pointer`}>{insight.action}</Button></div></CardContent></Card>;
            })}</div>
          ) : <p className="py-4 text-center text-sm text-muted-foreground">ဝယ်ယူမှုမှတ်တမ်း မလုံလောက်သေးပါ။ Demand records တွင် Service Amount ထည့်သွင်းပြီးနောက် အပြုအမူခွဲခြမ်းစိတ်ဖြာမှုကို ကြည့်ရှုနိုင်ပါသည်။</p>}
        </CardContent>}
      </Card>

      <Card className="border-2 border-sky-200 bg-sky-50/30 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/15">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-sm font-bold text-foreground"><Bot className="h-4 w-4 text-sky-600" />Smart Customer Suggestions</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Suggestions are hidden until you choose to review them.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowAiSuggestions((visible) => !visible)} className="shrink-0 border-border bg-card text-foreground hover:bg-muted/50">
            {showAiSuggestions ? 'Hide suggestions' : 'View suggestions'}
          </Button>
        </CardContent>
        {showAiSuggestions && totalPurchaseRecords > 0 && (
          <CardContent className="border-t border-sky-200 p-5 dark:border-sky-900/60">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {demandStatsLoading ? (
            <>
              <Skeleton className="h-32 rounded-xl animate-pulse" />
              <Skeleton className="h-32 rounded-xl animate-pulse" />
            </>
          ) : (
            (() => {
              const followUp = demandStats?.insights?.find(ins => ins.title.includes("Follow-up") || ins.actionType === "view_overdue" || ins.actionType === "view_due_today") || {
                type: "sales",
                severity: "info",
                title: "Follow-up နောက်ဆက်တွဲ ဆက်သွယ်မှု",
                message: "လတ်တလော လုပ်ဆောင်ရန်လိုအပ်သော follow-up နောက်ဆက်တွဲ ဖုန်းခေါ်ဆိုမှုများ မရှိသေးပါ။",
                recommendedAction: "နောက်ဆက်တွဲ လုပ်ဆောင်ရန်မရှိသေးသည့် Leads များအတွက် follow-up ရက်စွဲများ သတ်မှတ်ပေးပါ။",
                action: "Follow-up စစ်ဆေးရန်",
                actionType: "view_overdue"
              };

              const atRiskCustomers = customerAnalytics?.summary.atRiskCustomers ?? 0;
              const customerHealth = {
                type: "customer_health",
                severity: atRiskCustomers > 0 ? "warning" : "success",
                title: atRiskCustomers > 0 ? "ပြန်လည်ဆက်သွယ်ရန် Customer များရှိသည်" : "Customer ဝယ်ယူမှုအခြေအနေ ကောင်းမွန်သည်",
                message: atRiskCustomers > 0
                  ? `ဝယ်ယူမှုမှတ်တမ်းရှိသော်လည်း ရက် ၉၀ ကျော် လှုပ်ရှားမှုမရှိသော Customer ${atRiskCustomers} ဦး ရှိသည်။`
                  : "လက်ရှိ Customer ဝယ်ယူမှုမှတ်တမ်းများအရ ရက် ၉၀ ကျော် လှုပ်ရှားမှုမရှိသော Customer မတွေ့ရပါ။",
                recommendedAction: atRiskCustomers > 0
                  ? "ပြန်လည်ဝယ်ယူမှုရရှိစေရန် Follow-up ဆက်သွယ်ပြီး သင့်တော်သော Offer ကို ပေးပို့ပါ။"
                  : "Customer ဝယ်ယူမှုနှုန်းနှင့် Lifetime Value ကို ဆက်လက်စောင့်ကြည့်ပါ။",
                action: "Customer စာရင်း စစ်ဆေးရန်",
                actionType: "view_customer_health"
              };

              return [followUp, customerHealth].map((insight) => {
                const isUrgent = insight.severity === 'urgent';
                const isWarning = insight.severity === 'warning';
                const isSuccess = insight.severity === 'success';
                const CS_Icon = isUrgent ? AlertTriangle : isWarning ? Phone : CheckCircle2;
                return (
                  <Card
                    key={insight.title}
                    className={`bg-white dark:bg-card border-2 rounded-xl shadow-sm flex flex-col justify-between ${
                      isUrgent
                        ? 'border-red-300 border-l-8 border-l-red-500'
                        : isWarning
                        ? 'border-amber-300 border-l-8 border-l-amber-500'
                        : isSuccess
                        ? 'border-emerald-300 border-l-8 border-l-emerald-500'
                        : 'border-sky-300 border-l-8 border-l-sky-500'
                    }`}
                  >
                    <CardContent className="p-5 flex flex-col h-full justify-between">
                      <div>
                        <div className="flex items-center gap-3 mb-2">
                          <CS_Icon className={`w-5 h-5 shrink-0 ${isUrgent ? 'text-red-600' : isWarning ? 'text-amber-600' : isSuccess ? 'text-emerald-600' : 'text-sky-650'}`} />
                          <h4 className="font-bold text-slate-900 dark:text-slate-100">{insight.title}</h4>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mb-1 leading-relaxed">
                          {insight.message}
                        </p>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-300 leading-relaxed">
                          {insight.recommendedAction}
                        </p>
                      </div>
                      {insight.action && (
                        <div className="mt-3.5">
                          <Button
                            size="sm"
                            onClick={() => {
                              if (insight.actionType === 'view_high_priority') {
                                router.push('/sales-marketing?priority=high#report-table-section');
                              } else if (insight.actionType === 'view_missing_phone') {
                                router.push('/sales-marketing?missingField=phone#report-table-section');
                              } else if (insight.actionType === 'view_overdue' || insight.actionType === 'view_due_today') {
                                const el = document.getElementById('demand-leads-section');
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              } else if (insight.actionType === 'general_dashboard') {
                                router.push('/dashboard');
                              } else if (insight.actionType === 'view_customer_health') {
                                document.getElementById('customer-value-frequency')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              } else {
                                const el = document.getElementById('demand-leads-section');
                                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                              }
                            }}
                            className={`${
                              isUrgent
                                ? 'bg-red-600 hover:bg-red-700 text-white'
                                : isWarning
                                ? 'bg-amber-500 hover:bg-amber-600 text-white'
                                : isSuccess
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                : 'bg-sky-600 hover:bg-sky-700 text-white'
                            } text-xs font-bold rounded-lg px-4 h-8 cursor-pointer transition shadow-sm border-none`}
                          >
                            {insight.action}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              });
            })()
          )}
        </div>
          </CardContent>
        )}
      </Card>

      {/* 1. Purchased Customers Directory Card */}
      <Card className="bg-card border-2 border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle className="text-lg font-extrabold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
            1. Purchased Customers Directory
          </CardTitle>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search customers..."
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                className="pl-9 bg-muted/50 border-border text-foreground placeholder:text-muted-foreground w-full sm:w-60 focus-visible:ring-ring"
              />
            </div>
            <Button
              onClick={openCreateCustomer}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-10 text-xs font-bold transition-all shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Client
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-6 py-4 text-left font-extrabold">Customer Name</th>
                  <th className="px-6 py-4 text-left font-extrabold">Company</th>
                  <th className="px-6 py-4 text-left font-extrabold">Purchased Service</th>
                  <th className="px-6 py-4 text-right font-extrabold">Purchase Amount (MMK)</th>
                  <th className="px-6 py-4 text-center font-extrabold">Status</th>
                  <th className="px-6 py-4 text-center font-extrabold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {customerLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <tr key={index}>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-32" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-28" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-6 py-4 text-right"><Skeleton className="h-4 w-20 ml-auto" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-16 mx-auto" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-14 mx-auto" /></td>
                    </tr>
                  ))
                ) : customerData?.customers && customerData.customers.length > 0 ? (
                  customerData.customers.map((customer) => {
                    const latestRecord = customer.demandRecords?.[0];
                    const recordCount = customer.demandRecords?.length || 0;
                    const amountPaid = customer.demandRecords?.reduce((sum, record) => sum + (record.serviceAmount || 0), 0) || 0;

                    return (
                      <tr key={customer.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 align-middle">
                        <td className="px-6 py-4">
                          <Link href={`/customers/${customer.id}`} className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 transition-colors">
                            {customer.name}
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400 font-semibold">{customer.company || '-'}</td>
                        <td className="px-6 py-4 text-blue-600 dark:text-blue-400 font-bold">
                          {latestRecord ? (
                            <span className="inline-flex items-center gap-1.5">
                              {latestRecord.serviceName || 'Package Deal'}
                              {recordCount > 1 && (
                                <Badge variant="outline" className="text-[10px] px-1 py-0 bg-blue-50/50 text-blue-700 shrink-0 font-mono">
                                  +{recordCount - 1} more
                                </Badge>
                              )}
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal italic">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-black text-right text-slate-800 dark:text-slate-200">
                          {amountPaid.toLocaleString()}
                        </td>
                        <td className="px-6 py-4 text-center">
                          {latestRecord ? (
                            <Badge
                              variant="outline"
                              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 ${
                                latestRecord.status === 'closed' || latestRecord.status === 'completed'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
                                  : latestRecord.status === 'pending'
                                  ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300'
                                  : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300'
                              }`}
                            >
                              {latestRecord.status}
                            </Badge>
                          ) : '-'}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => latestRecord && openEditLead({
                                ...latestRecord,
                                customerName: latestRecord.customerName || customer.name,
                                customer: { ...customer, demandRecords: undefined },
                              })}
                              aria-label={`Edit purchase record for ${customer.name}`}
                              className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setCustomerDeleteConfirmText('');
                                setCustomerToDelete(customer);
                              }}
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-500">
                      No purchased customers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>

        {/* Customer Pagination Footer */}
        {customerData && customerData.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-card/20 px-6 py-4">
            <div className="text-xs text-muted-foreground font-mono">
              Showing Page <span className="text-foreground font-bold">{customerPage}</span> of{' '}
              <span className="text-foreground font-bold">{customerData.totalPages}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={customerPage <= 1}
                onClick={() => setCustomerPage(p => Math.max(1, p - 1))}
                className="bg-card border-border text-foreground hover:bg-muted cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={customerPage >= customerData.totalPages}
                onClick={() => setCustomerPage(p => Math.min(customerData.totalPages, p + 1))}
                className="bg-card border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* 2. Purchase Records Data Card */}
      <Card id="demand-leads-section" className="bg-card border-2 border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <CardTitle className="text-lg font-extrabold text-slate-900 dark:text-slate-100 uppercase tracking-wide">
            2. Purchase Records Data
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            <Select value={followUpFilter} onValueChange={(val) => setFollowUpFilter(val || 'all')}>
              <SelectTrigger className="h-10 w-40 rounded-lg border border-border bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
                {followUpFilter === 'overdue' ? 'Overdue Follow-ups' : followUpFilter === 'due' ? 'Due Today' : 'All Follow-ups'}
              </SelectTrigger>
              <SelectContent className="bg-card border-border text-foreground rounded-lg">
                <SelectItem value="all">All Follow-ups</SelectItem>
                <SelectItem value="overdue">Overdue Follow-ups</SelectItem>
                <SelectItem value="due">Due Today</SelectItem>
              </SelectContent>
            </Select>
            <div className="relative flex-1 sm:flex-initial">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search purchase records..."
                value={demandSearch}
                onChange={(e) => setDemandSearch(e.target.value)}
                className="pl-9 bg-muted/50 border-border text-foreground placeholder:text-muted-foreground w-full sm:w-60 focus-visible:ring-ring"
              />
            </div>
            <Button
              onClick={openCreateLead}
              className="bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 h-10 text-xs font-bold transition-all shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Purchase
            </Button>
          </div>
        </div>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/60 text-xs uppercase text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-6 py-4 text-left font-extrabold">Purchase Date</th>
                  <th className="px-6 py-4 text-left font-extrabold">Customer Name</th>
                  <th className="px-6 py-4 text-left font-extrabold">Source Channel</th>
                  <th className="px-6 py-4 text-left font-extrabold">Purchased Service</th>
                  <th className="px-6 py-4 text-left font-extrabold">Contact</th>
                  <th className="px-6 py-4 text-center font-extrabold">Potential</th>
                  <th className="px-6 py-4 text-center font-extrabold">Status</th>
                  <th className="px-6 py-4 text-center font-extrabold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {demandLoading ? (
                  Array.from({ length: 5 }).map((_, index) => (
                    <tr key={index}>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-20" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-32" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-28" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-36" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-4 w-24" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-24 mx-auto" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-16 mx-auto" /></td>
                      <td className="px-6 py-4"><Skeleton className="h-5 w-14 mx-auto" /></td>
                    </tr>
                  ))
                ) : demandData?.records && demandData.records.length > 0 ? (
                  demandData.records.map((lead) => {
                    const leadPhone = formatPhoneNumber(lead.customer?.phone);
                    const leadCompany = lead.customer?.company;

                    return (
                      <tr key={lead.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-900/40 align-middle">
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-slate-600 dark:text-slate-400">
                          <time dateTime={lead.createdAt}>
                            {format(new Date(lead.createdAt), 'd MMM yyyy')}
                          </time>
                        </td>
                        <td className="px-6 py-4 font-bold text-slate-900 dark:text-slate-100">
                          {lead.customerId ? (
                            <Link href={`/customers/${lead.customerId}`} className="hover:text-blue-600 transition-colors">
                              {lead.customerName || 'Unknown'}
                            </Link>
                          ) : (
                            lead.customerName || 'Unknown'
                          )}
                          {leadCompany && (
                            <span className="block text-xs font-normal text-muted-foreground">{leadCompany}</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-slate-600 dark:text-slate-400 font-semibold">{lead.sourceChannel || lead.sourceType || 'Telegram'}</td>
                        <td className="px-6 py-4 text-slate-700 dark:text-slate-300">
                          {lead.serviceName || (lead.note ? lead.note.slice(0, 45) + (lead.note.length > 45 ? '...' : '') : '-')}
                        </td>
                        <td className="px-6 py-4 font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">
                          {leadPhone || (
                            <span className="text-slate-400 font-normal italic">No contact</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Badge variant="outline" className={`text-[10px] font-extrabold uppercase px-2.5 py-0.5 ${priorityColors[lead.priority] || priorityColors.medium}`}>
                            {lead.priority === 'high' ? 'High Potential' : lead.priority}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <Badge variant="outline" className={`text-[10px] font-bold px-2 py-0.5 capitalize ${leadStatusColors[lead.status] || leadStatusColors.new}`}>
                            {lead.status}
                          </Badge>
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => openEditLead(lead)}
                              className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-md cursor-pointer"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                setLeadDeleteConfirmText('');
                                setLeadToDelete(lead);
                              }}
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="px-6 py-12 text-center text-sm text-slate-500">
                      No purchase records found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>

        {/* Purchase Records Pagination Footer */}
        {demandData && demandData.totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-800 bg-card/20 px-6 py-4">
            <div className="text-xs text-muted-foreground font-mono">
              Showing Page <span className="text-foreground font-bold">{demandPage}</span> of{' '}
              <span className="text-foreground font-bold">{demandData.totalPages}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={demandPage <= 1}
                onClick={() => setDemandPage(p => Math.max(1, p - 1))}
                className="bg-card border-border text-foreground hover:bg-muted cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={demandPage >= demandData.totalPages}
                onClick={() => setDemandPage(p => Math.min(demandData.totalPages, p + 1))}
                className="bg-card border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* ─── MODALS ──────────────────────────────────────────────────────── */}

      {/* Customer Create/Edit Modal */}
      {(isCreatingCustomer || editingCustomer) && (
        <ModalPortal className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
          <form onSubmit={handleSaveCustomer} className="bg-card border border-border w-full max-w-lg rounded-lg overflow-hidden shadow-lg animate-in zoom-in-95 duration-200 text-foreground">
            <div className="flex justify-between items-center border-b border-border p-6 pb-4">
              <h3 className="text-lg font-bold text-foreground">
                {editingCustomer ? `Edit Client: ${editingCustomer.name}` : 'Add New Client'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingCustomer(false);
                  setEditingCustomer(null);
                }}
                className="text-muted-foreground hover:text-foreground text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Name *</label>
                  <Input
                    required
                    value={customerForm.name}
                    onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                    placeholder="Enter client's full name"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Company</label>
                  <Input
                    value={customerForm.company}
                    onChange={(e) => setCustomerForm({ ...customerForm, company: e.target.value })}
                    placeholder="Company Name"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Phone</label>
                  <Input
                    value={customerForm.phone}
                    onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                    placeholder="Phone number"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Email</label>
                  <Input
                    type="email"
                    value={customerForm.email}
                    onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })}
                    placeholder="Email address"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Client Status</label>
                  <select
                    value={customerForm.status}
                    onChange={(e) => setCustomerForm({ ...customerForm, status: e.target.value })}
                    className="w-full h-10 bg-muted border border-border rounded-lg px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Notes</label>
                <textarea
                  value={customerForm.notes}
                  onChange={(e) => setCustomerForm({ ...customerForm, notes: e.target.value })}
                  placeholder="Notes about client history, SLA requirements..."
                  className="w-full h-20 bg-muted/40 border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreatingCustomer(false);
                  setEditingCustomer(null);
                }}
                className="bg-muted/50 border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createCustomerMutation.isPending || updateCustomerMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-bold shrink-0 cursor-pointer"
              >
                {(createCustomerMutation.isPending || updateCustomerMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />
                )}
                Save Client
              </Button>
            </div>
          </form>
        </ModalPortal>
      )}

      {/* Demand Lead Create/Edit Modal */}
      {(isCreatingLead || editingLead) && (
        <ModalPortal className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200 p-4">
          <form onSubmit={handleSaveLead} className="bg-card border border-border w-full max-w-lg rounded-lg overflow-hidden shadow-lg animate-in zoom-in-95 duration-200 text-foreground">
            <div className="flex justify-between items-center border-b border-border p-6 pb-4">
              <h3 className="text-lg font-bold text-foreground">
                {editingLead ? 'Edit Purchase Record' : 'Add Purchase Record'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingLead(false);
                  setEditingLead(null);
                }}
                className="text-muted-foreground hover:text-foreground text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Customer Name *</label>
                  <Input
                    required
                    value={leadForm.customerName}
                    onChange={(e) => setLeadForm({ ...leadForm, customerName: e.target.value })}
                    placeholder="e.g. Aung Myint"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Phone Number</label>
                  <Input
                    value={leadForm.customerPhone}
                    onChange={(e) => setLeadForm({ ...leadForm, customerPhone: e.target.value })}
                    placeholder="e.g. 09950111222"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Company Name</label>
                  <Input
                    value={leadForm.customerCompany}
                    onChange={(e) => setLeadForm({ ...leadForm, customerCompany: e.target.value })}
                    placeholder="e.g. Mandalay Retail"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Purchased Service</label>
                  <Input
                    value={leadForm.serviceName}
                    onChange={(e) => setLeadForm({ ...leadForm, serviceName: e.target.value })}
                    placeholder="e.g. Gold Package, AI CRM Setup"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Purchase Amount (Ks)</label>
                  <Input
                    type="number"
                    value={leadForm.serviceAmount}
                    onChange={(e) => setLeadForm({ ...leadForm, serviceAmount: e.target.value })}
                    placeholder="e.g. 1500000"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Quantity</label>
                  <Input
                    type="number"
                    value={leadForm.serviceQty}
                    onChange={(e) => setLeadForm({ ...leadForm, serviceQty: e.target.value })}
                    placeholder="1"
                    className="bg-muted/35 border-border text-foreground"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Follow-up Date</label>
                  <Input
                    type="date"
                    value={leadForm.followUpDate}
                    onChange={(e) => setLeadForm({ ...leadForm, followUpDate: e.target.value })}
                    className="bg-muted/35 border-border text-foreground w-full"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Priority / Potential</label>
                  <select
                    value={leadForm.priority}
                    onChange={(e) => setLeadForm({ ...leadForm, priority: e.target.value })}
                    className="w-full h-10 bg-muted border border-border rounded-lg px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="high">High Potential</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div className="space-y-1.5 col-span-2">
                  <label className="text-xs font-semibold uppercase text-muted-foreground">Purchase Status</label>
                  <select
                    value={leadForm.status}
                    onChange={(e) => setLeadForm({ ...leadForm, status: e.target.value })}
                    className="w-full h-10 bg-muted border border-border rounded-lg px-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="new">New Purchase</option>
                    <option value="pending">Pending</option>
                    <option value="closed">Closed</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase text-muted-foreground">Conversation Note / Details</label>
                <textarea
                  value={leadForm.note}
                  onChange={(e) => setLeadForm({ ...leadForm, note: e.target.value })}
                  placeholder="Requested custom reports, wants domain transfer support..."
                  className="w-full h-20 bg-muted/40 border border-border rounded-lg p-3 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder:text-muted-foreground"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 p-6 pt-2 border-t border-border">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCreatingLead(false);
                  setEditingLead(null);
                }}
                className="bg-muted/50 border-border text-foreground hover:bg-muted cursor-pointer"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={createLeadMutation.isPending || updateLeadMutation.isPending}
                className="bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 font-bold shrink-0 cursor-pointer"
              >
                {(createLeadMutation.isPending || updateLeadMutation.isPending) && (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin shrink-0" />
                )}
                Save Purchase
              </Button>
            </div>
          </form>
        </ModalPortal>
      )}

      {/* Delete Single Customer Confirmation */}
      {customerToDelete && (
        <AlertDialog open={!!customerToDelete} onOpenChange={(open) => {
          if (!open) {
            setCustomerToDelete(null);
            setCustomerDeleteConfirmText('');
          }
        }}>
          <AlertDialogContent className="bg-card border-border text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {customerToDelete.name}?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                This will move this client to Trash. Related activity history stays linked, and admins can restore the client later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Type confirm to move this client to Trash</label>
              <Input
                value={customerDeleteConfirmText}
                onChange={(event) => setCustomerDeleteConfirmText(event.target.value)}
                disabled={deleteCustomer.isPending}
                placeholder="confirm"
                className="h-10 font-mono"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border text-foreground">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await deleteCustomer.mutateAsync(customerToDelete.id);
                  setCustomerToDelete(null);
                  setCustomerDeleteConfirmText('');
                }}
                disabled={deleteCustomer.isPending || customerDeleteConfirmText.toLowerCase() !== 'confirm'}
                className="bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
              >
                {deleteCustomer.isPending ? 'Deleting…' : 'Move to Trash'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Delete Single Lead Confirmation */}
      {leadToDelete && (
        <AlertDialog open={!!leadToDelete} onOpenChange={(open) => {
          if (!open) {
            setLeadToDelete(null);
            setLeadDeleteConfirmText('');
          }
        }}>
          <AlertDialogContent className="bg-card border-border text-foreground">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Lead for {leadToDelete.customerName || 'Unknown'}?</AlertDialogTitle>
              <AlertDialogDescription className="text-muted-foreground">
                This will move this demand lead record to Trash. Admins can restore it later.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Type confirm to move this lead to Trash</label>
              <Input
                value={leadDeleteConfirmText}
                onChange={(event) => setLeadDeleteConfirmText(event.target.value)}
                disabled={deleteLeadMutation.isPending}
                placeholder="confirm"
                className="h-10 font-mono"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel className="border-border text-foreground">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  await deleteLeadMutation.mutateAsync(leadToDelete.id);
                  setLeadToDelete(null);
                  setLeadDeleteConfirmText('');
                }}
                disabled={deleteLeadMutation.isPending || leadDeleteConfirmText.toLowerCase() !== 'confirm'}
                className="bg-red-600 hover:bg-red-700 text-white font-bold cursor-pointer"
              >
                {deleteLeadMutation.isPending ? 'Deleting…' : 'Move to Trash'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CustomerMetricCard({ label, value, icon: Icon, tone, loading }: { label: string; value: number; icon: typeof DollarSign; tone: string; loading: boolean }) {
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${tone} bg-card p-4 dark:border-slate-800`}>
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">{label}</p>{loading ? <Skeleton className="mt-2 h-6 w-28" /> : <p className="mt-2 text-xl font-black text-foreground">{Math.round(value).toLocaleString()} <span className="text-[10px] font-bold text-slate-400">MMK</span></p>}</div>
        <Icon className="h-5 w-5 text-slate-400" />
      </div>
    </div>
  );
}

function CustomerRanking({ title, items, loading, accent }: { title: string; items: CustomerAnalyticsMetric[]; loading: boolean; accent: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/30"><h3 className={`text-sm font-bold ${accent}`}>{title}</h3><span className="text-[11px] text-muted-foreground">Spend · frequency · LTV</span></div>
      {loading ? <div className="space-y-3 p-4"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div> : items.length === 0 ? <p className="p-6 text-center text-sm text-muted-foreground">No customer spending data for this period.</p> : <div className="divide-y divide-slate-100 dark:divide-slate-900">{items.slice(0, 5).map((customer, index) => <div key={customer.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3"><span className="text-xs font-black text-slate-400">{index + 1}</span><div className="min-w-0"><p className="truncate text-sm font-semibold text-foreground">{customer.name}</p><p className="truncate text-[11px] text-muted-foreground">{customer.purchaseFrequency} purchase{customer.purchaseFrequency === 1 ? '' : 's'} · LTV {Math.round(customer.lifetimeValue).toLocaleString()} MMK</p></div><p className="whitespace-nowrap text-sm font-bold text-foreground">{Math.round(customer.totalSpend).toLocaleString()}</p></div>)}</div>}
      {items.length > 5 && <p className="border-t border-slate-100 px-4 py-2 text-center text-[11px] font-semibold text-muted-foreground dark:border-slate-900">Showing 5 of {items.length} customers</p>}
    </div>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-500 animate-pulse">Loading Customers...</div>}>
      <CustomersPageContent />
    </Suspense>
  );
}
