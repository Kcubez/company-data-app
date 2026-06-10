import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { projectExpiriesApi, type ProjectExpiriesParams, type UpdateProjectExpiryPayload } from "@/lib/api";
import { toast } from "sonner";

export const projectExpiriesKeys = {
  all: ["project-expiries"] as const,
  lists: () => [...projectExpiriesKeys.all, "list"] as const,
  list: (params: ProjectExpiriesParams) => [...projectExpiriesKeys.lists(), params] as const,
  recommendations: () => [...projectExpiriesKeys.all, "recommendations"] as const,
};

export function useProjectExpiries(params: ProjectExpiriesParams = {}) {
  return useQuery({
    queryKey: projectExpiriesKeys.list(params),
    queryFn: () => projectExpiriesApi.list(params),
    refetchInterval: 5000,
  });
}

export function useProjectExpiryRecommendations() {
  return useQuery({
    queryKey: projectExpiriesKeys.recommendations(),
    queryFn: () => projectExpiriesApi.recommendations(),
    // AI calls are costly — fetch once on mount, then only on manual refresh.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useDeleteAllProjectExpiries() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => projectExpiriesApi.deleteAll(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: projectExpiriesKeys.all });
      toast.success(`Deleted ${res.deleted} project record(s)`);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete records");
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
    onError: (error: any) => {
      toast.error(error.message || "Failed to update record");
    },
  });
}
