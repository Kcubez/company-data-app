import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { websiteUpdatesApi, type WebsiteUpdate, type WebsiteUpdatesParams } from "@/lib/api";
import { clearListQueryData, removeListItemQueryData } from "@/lib/query-cache";
import { toast } from "sonner";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export const websiteUpdatesKeys = {
  all: ["website-updates"] as const,
  lists: () => [...websiteUpdatesKeys.all, "list"] as const,
  list: (params: WebsiteUpdatesParams) => [...websiteUpdatesKeys.lists(), params] as const,
  recommendations: (params: { dateFrom?: string; dateTo?: string } = {}) =>
    [...websiteUpdatesKeys.all, "recommendations", params] as const,
};

export function useWebsiteUpdates(params: WebsiteUpdatesParams = {}) {
  return useQuery({
    queryKey: websiteUpdatesKeys.list(params),
    queryFn: () => websiteUpdatesApi.list(params),
    refetchInterval: 5000,
  });
}

export function useUpdateWebsiteUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & Partial<Pick<WebsiteUpdate, "name" | "url" | "businessType" | "packageName" | "status" | "remark">>) =>
      websiteUpdatesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: websiteUpdatesKeys.all });
      toast.success("Website record updated successfully");
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to update record"));
    },
  });
}

export function useDeleteWebsiteUpdate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => websiteUpdatesApi.delete(id),
    onSuccess: (_res, id) => {
      removeListItemQueryData(queryClient, websiteUpdatesKeys.all, "records", id);
      queryClient.invalidateQueries({ queryKey: websiteUpdatesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Website record deleted");
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to delete record"));
    },
  });
}

export function useWebsiteUpdateRecommendations(options: { enabled?: boolean; dateFrom?: string; dateTo?: string } = {}) {
  return useQuery({
    queryKey: websiteUpdatesKeys.recommendations(options),
    queryFn: () => websiteUpdatesApi.recommendations(options),
    // Local recommendations change only when underlying records change.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: options.enabled ?? true,
  });
}

export function useDeleteAllWebsiteUpdates() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { dateFrom?: string; dateTo?: string } = {}) => websiteUpdatesApi.deleteAll(params),
    onSuccess: (res) => {
      clearListQueryData(queryClient, websiteUpdatesKeys.all, "records");
      queryClient.invalidateQueries({ queryKey: websiteUpdatesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(`Deleted ${res.deleted} website record(s)`);
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to delete records"));
    },
  });
}
