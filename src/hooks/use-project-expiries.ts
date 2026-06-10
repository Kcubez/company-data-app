import { useQuery } from "@tanstack/react-query";
import { projectExpiriesApi, type ProjectExpiriesParams } from "@/lib/api";

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
