import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { demandRecordsApi, type DemandRecordsParams, type UpdateDemandRecordPayload } from "@/lib/api";
import { clearListQueryData, removeListItemQueryData } from "@/lib/query-cache";
import { toast } from "sonner";

export function useDemandRecords(params: DemandRecordsParams = {}) {
  return useQuery({
    queryKey: ["demand-records", params],
    queryFn: () => demandRecordsApi.list(params),
    refetchInterval: 5000,
  });
}

export function useDemandRecordStats(params: { dateFrom?: string; dateTo?: string } = {}) {
  return useQuery({
    queryKey: ["demand-record-stats", params.dateFrom, params.dateTo],
    queryFn: () => demandRecordsApi.stats(params),
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
    mutationFn: (params: { dateFrom?: string; dateTo?: string } = {}) => demandRecordsApi.deleteAll(params),
    onSuccess: (res) => {
      clearListQueryData(queryClient, ["demand-records"], "records");
      queryClient.invalidateQueries({ queryKey: ["demand-records"] });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
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

export function useCreateDemandRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => demandRecordsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["demand-records"] });
      queryClient.invalidateQueries({ queryKey: ["demand-record-stats"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      toast.success("Lead created successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create lead");
    },
  });
}

export function useDeleteDemandRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => demandRecordsApi.delete(id),
    onSuccess: (_res, id) => {
      removeListItemQueryData(queryClient, ["demand-records"], "records", id);
      queryClient.invalidateQueries({ queryKey: ["demand-records"] });
      queryClient.invalidateQueries({ queryKey: ["trash"] });
      queryClient.invalidateQueries({ queryKey: ["demand-record-stats"] });
      toast.success("Lead deleted successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete lead");
    },
  });
}
