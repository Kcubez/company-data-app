"use client";

import {
  businessReportsApi,
  BusinessReport,
  BusinessReportsParams,
} from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const businessReportKeys = {
  all: ["business-reports"] as const,
  list: (params: BusinessReportsParams) =>
    [...businessReportKeys.all, "list", params] as const,
  stats: (params?: { dateFrom?: string; dateTo?: string }) =>
    [...businessReportKeys.all, "stats", params] as const,
  recommendations: () => [...businessReportKeys.all, "recommendations"] as const,
};

export function useBusinessReports(params: BusinessReportsParams = {}) {
  return useQuery({
    queryKey: businessReportKeys.list(params),
    queryFn: () => businessReportsApi.list(params),
  });
}

export function useBusinessReportStats(params: { dateFrom?: string; dateTo?: string } = {}) {
  return useQuery({
    queryKey: businessReportKeys.stats(params),
    queryFn: () => businessReportsApi.stats(params),
  });
}

export function useBusinessReportRecommendations() {
  return useQuery({
    queryKey: businessReportKeys.recommendations(),
    queryFn: () => businessReportsApi.recommendations(),
    staleTime: 1000 * 60 * 5, // 5 min cache
  });
}

export function useUpdateBusinessReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<BusinessReport> }) =>
      businessReportsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: businessReportKeys.all });
      toast.success("Record updated successfully");
    },
    onError: () => toast.error("Failed to update record"),
  });
}

export function useDeleteBusinessReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => businessReportsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: businessReportKeys.all });
      toast.success("Record deleted");
    },
    onError: () => toast.error("Failed to delete record"),
  });
}

export function useDeleteAllBusinessReports() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { dateFrom?: string; dateTo?: string } = {}) => businessReportsApi.deleteAll(params),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: businessReportKeys.all });
      toast.success(`Deleted ${data.deleted} records`);
    },
    onError: () => toast.error("Failed to delete records"),
  });
}
