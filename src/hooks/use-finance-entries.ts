"use client";

import { financeEntriesApi, type FinanceEntriesParams, type FinanceEntry } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const financeEntryKeys = {
  all: ["finance-entries"] as const,
  list: (params: FinanceEntriesParams) => [...financeEntryKeys.all, "list", params] as const,
};

export function useFinanceEntries(params: FinanceEntriesParams = {}) {
  return useQuery({ queryKey: financeEntryKeys.list(params), queryFn: () => financeEntriesApi.list(params) });
}

function useRefresh() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: financeEntryKeys.all });
}

export function useCreateFinanceEntry() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: financeEntriesApi.create,
    onSuccess: () => { refresh(); toast.success("Finance record added"); },
    onError: () => toast.error("Could not add finance record"),
  });
}

export function useUpdateFinanceEntry() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<FinanceEntry> }) => financeEntriesApi.update(id, data),
    onSuccess: () => { refresh(); toast.success("Finance record updated"); },
    onError: () => toast.error("Could not update finance record"),
  });
}

export function useDeleteFinanceEntry() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: financeEntriesApi.delete,
    onSuccess: () => { refresh(); toast.success("Finance record moved to Trash"); },
    onError: () => toast.error("Could not delete finance record"),
  });
}

export function useDeleteAllFinanceEntries() {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (params: { dateFrom?: string; dateTo?: string } = {}) => financeEntriesApi.deleteAll(params),
    onSuccess: (data) => { refresh(); toast.success(`Deleted ${data.deleted} finance records`); },
    onError: () => toast.error("Could not delete finance records"),
  });
}
