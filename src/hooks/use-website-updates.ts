import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { websiteUpdatesApi, type WebsiteUpdatesParams } from "@/lib/api";
import { clearListQueryData } from "@/lib/query-cache";
import { toast } from "sonner";

export const websiteUpdatesKeys = {
  all: ["website-updates"] as const,
  lists: () => [...websiteUpdatesKeys.all, "list"] as const,
  list: (params: WebsiteUpdatesParams) => [...websiteUpdatesKeys.lists(), params] as const,
  recommendations: () => [...websiteUpdatesKeys.all, "recommendations"] as const,
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
    mutationFn: ({ id, status, remark }: { id: string; status?: string; remark?: string | null }) =>
      websiteUpdatesApi.update(id, { status, remark }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: websiteUpdatesKeys.all });
      toast.success("Website update status updated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update record");
    },
  });
}

export function useWebsiteUpdateRecommendations() {
  return useQuery({
    queryKey: websiteUpdatesKeys.recommendations(),
    queryFn: () => websiteUpdatesApi.recommendations(),
    // AI calls are costly — fetch once on mount, then only on manual refresh.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
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
      toast.success(`Deleted ${res.deleted} website record(s)`);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete records");
    },
  });
}
