import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { demandRecordsApi, type DemandRecordsParams, type UpdateDemandRecordPayload } from "@/lib/api";
import { toast } from "sonner";

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

export function useDeleteAllDemandRecords() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => demandRecordsApi.deleteAll(),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["demand-records"] });
      queryClient.invalidateQueries({ queryKey: ["demand-record-stats"] });
      queryClient.invalidateQueries({ queryKey: ["demand-record-recommendations"] });
      toast.success(`Deleted ${res.count} demand record(s)`);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete records");
    },
  });
}

export function useUpdateDemandRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateDemandRecordPayload) =>
      demandRecordsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["demand-records"] });
      queryClient.invalidateQueries({ queryKey: ["demand-record-stats"] });
      toast.success("Record updated successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update record");
    },
  });
}

export function useImportDemandFile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (file: File) => demandRecordsApi.importFile(file),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["demand-records"] });
      queryClient.invalidateQueries({ queryKey: ["demand-record-stats"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      toast.success(
        `Imported ${res.importedCount} row(s). ${res.highPriority} high priority, ${res.missingPhone} missing phone.`,
      );
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to import file");
    },
  });
}
