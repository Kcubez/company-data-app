import { dataApprovalsApi } from '@/lib/api';
import { useQuery } from '@tanstack/react-query';

export const dataApprovalKeys = {
  all: ['data-approvals'] as const,
};

export function useDataApprovals() {
  return useQuery({
    queryKey: dataApprovalKeys.all,
    queryFn: dataApprovalsApi.list,
  });
}
