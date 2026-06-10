import { useQuery } from "@tanstack/react-query";
import { demandRecordsApi, type DemandRecordsParams } from "@/lib/api";

export function useDemandRecords(params: DemandRecordsParams = {}) {
  return useQuery({
    queryKey: ["demand-records", params],
    queryFn: () => demandRecordsApi.list(params),
    refetchInterval: 5000,
  });
}

export function useDemandRecordStats() {
  return useQuery({
    queryKey: ["demand-record-stats"],
    queryFn: () => demandRecordsApi.stats(),
    refetchInterval: 10000,
  });
}

export function useDemandRecordRecommendations() {
  return useQuery({
    queryKey: ["demand-record-recommendations"],
    queryFn: () => demandRecordsApi.recommendations(),
    // AI calls are costly — fetch once on mount, then only on manual refresh.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
