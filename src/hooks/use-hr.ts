import { hrApi } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

export const hrKeys = {
  all: ['hr'] as const,
  staff: () => [...hrKeys.all, 'staff'] as const,
};

export function useHRStaff() {
  return useQuery({
    queryKey: hrKeys.staff(),
    queryFn: hrApi.list,
  });
}

export function useCreateHRStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { email: string; allowedDepartments: string[] }) => hrApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKeys.staff() });
      queryClient.invalidateQueries({ queryKey: ['senders'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'senders'] });
      toast.success('Staff member pre-authorized successfully');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to add staff member');
    },
  });
}

export function useUpdateHRStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: { isAuthorized?: boolean; isDataApprover?: boolean; allowedDepartments?: string[] } }) =>
      hrApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKeys.staff() });
      queryClient.invalidateQueries({ queryKey: ['senders'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'senders'] });
      toast.success('Staff permissions updated');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to update staff member');
    },
  });
}

export function useDeleteHRStaff() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => hrApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: hrKeys.staff() });
      queryClient.invalidateQueries({ queryKey: ['senders'] });
      queryClient.invalidateQueries({ queryKey: ['settings', 'senders'] });
      toast.success('Staff access revoked');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'Failed to revoke staff access');
    },
  });
}
