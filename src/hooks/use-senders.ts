import { useQuery } from "@tanstack/react-query";
import { sendersApi } from "@/lib/api";

export function useSenders() {
  return useQuery({
    queryKey: ["senders"],
    queryFn: () => sendersApi.list().then((res) => res.senders),
    refetchInterval: 10000, // Refresh every 10 seconds
  });
}
