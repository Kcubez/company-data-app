import { trashApi, type TrashParams, type TrashRecordType } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const trashKeys = {
  all: ["trash"] as const,
  list: (params: TrashParams) => [...trashKeys.all, "list", params] as const,
};

function invalidateBusinessData(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: trashKeys.all });
  queryClient.invalidateQueries({ queryKey: ["customers"] });
  queryClient.invalidateQueries({ queryKey: ["demand-records"] });
  queryClient.invalidateQueries({ queryKey: ["business-reports"] });
  queryClient.invalidateQueries({ queryKey: ["project-expiries"] });
  queryClient.invalidateQueries({ queryKey: ["website-updates"] });
  queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
}

export function useTrash(params: TrashParams = {}) {
  return useQuery({
    queryKey: trashKeys.list(params),
    queryFn: () => trashApi.list(params),
  });
}

export function useRestoreTrashRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, id }: { type: TrashRecordType; id: string }) =>
      trashApi.restore(type, id),
    onSuccess: (res) => {
      invalidateBusinessData(queryClient);
      toast.success(res.restored ? "Record restored" : "Record was already restored");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to restore record");
    },
  });
}

export function useRequestTrashRestore() {
  return useMutation({
    mutationFn: ({ type, id }: { type: TrashRecordType; id: string }) =>
      trashApi.requestRestore(type, id),
    onSuccess: (res) => {
      toast.success(res.message || "Restore request sent");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to request restore");
    },
  });
}

export function usePermanentDeleteTrashRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ type, id }: { type: TrashRecordType; id: string }) =>
      trashApi.permanentDelete(type, id, "PERMANENT DELETE"),
    onSuccess: (res) => {
      invalidateBusinessData(queryClient);
      toast.success(res.deleted ? "Record permanently deleted" : "Record was already removed");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to permanently delete record");
    },
  });
}
