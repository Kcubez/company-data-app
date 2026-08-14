import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectExpiriesApi, type ProjectExpiriesParams, type UpdateProjectExpiryPayload } from "@/lib/api";
import { clearListQueryData, removeListItemQueryData } from "@/lib/query-cache";
import { toast } from "sonner";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export const projectExpiriesKeys = {
  all: ["project-expiries"] as const,
  lists: () => [...projectExpiriesKeys.all, "list"] as const,
  list: (params: ProjectExpiriesParams) => [...projectExpiriesKeys.lists(), params] as const,
  recommendations: (params: { dateFrom?: string; dateTo?: string } = {}) =>
    [...projectExpiriesKeys.all, "recommendations", params] as const,
};

export function useProjectExpiries(params: ProjectExpiriesParams = {}) {
  return useQuery({
    queryKey: projectExpiriesKeys.list(params),
    queryFn: () => projectExpiriesApi.list(params),
    refetchInterval: 5000,
  });
}

export function useProjectExpiryRecommendations(params: { dateFrom?: string; dateTo?: string } = {}) {
  return useQuery({
    queryKey: projectExpiriesKeys.recommendations(params),
    queryFn: () => projectExpiriesApi.recommendations(params),
    // AI calls are costly — fetch once on mount, then only on manual refresh.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useDeleteAllProjectExpiries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { dateFrom?: string; dateTo?: string } = {}) => projectExpiriesApi.deleteAll(params),
    onSuccess: (res) => {
      clearListQueryData(queryClient, projectExpiriesKeys.all, "records");
      queryClient.invalidateQueries({ queryKey: projectExpiriesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(`Deleted ${res.deleted} project record(s)`);
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to delete records"));
    },
  });
}

export function useDeleteProjectExpiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => projectExpiriesApi.delete(id),
    onSuccess: (_res, id) => {
      removeListItemQueryData(queryClient, projectExpiriesKeys.all, "records", id);
      queryClient.invalidateQueries({ queryKey: projectExpiriesKeys.all });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success("Project record deleted");
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to delete record"));
    },
  });
}

export function useUpdateProjectExpiry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateProjectExpiryPayload) =>
      projectExpiriesApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: projectExpiriesKeys.all });
      toast.success("Project expiry updated successfully");
    },
    onError: (error: unknown) => {
      toast.error(errorMessage(error, "Failed to update record"));
    },
  });
}
