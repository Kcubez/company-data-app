"use client";

import { customerAnalyticsApi } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export function useCustomerAnalytics(params: { dateFrom?: string; dateTo?: string } = {}) {
  return useQuery({
    queryKey: ["customer-analytics", params],
    queryFn: () => customerAnalyticsApi.get(params),
  });
}
