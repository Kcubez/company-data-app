import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function useSyncPolling() {
  const queryClient = useQueryClient();
  const lastModifiedRef = useRef<number | null>(null);
  const telegramLastModifiedRef = useRef<number | null>(null);
  const isPollingRef = useRef<boolean>(false);

  useEffect(() => {
    let intervalId: NodeJS.Timeout | null = null;

    async function checkSync() {
      // Skip polling if the browser tab is not active/visible
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      
      if (isPollingRef.current) return;
      isPollingRef.current = true;

      try {
        const res = await fetch("/api/sync/last-modified");
        if (!res.ok) {
          // If unauthorized or server error, we fail silently or stop polling
          if (res.status === 401) {
            if (intervalId) clearInterval(intervalId);
          }
          return;
        }

        const data = await res.json();
        const serverLastModified = Number(data.lastModified);
        const serverTelegramLastModified = Number(data.telegramLastModified);

        // First load: initialize references
        if (lastModifiedRef.current === null || telegramLastModifiedRef.current === null) {
          lastModifiedRef.current = serverLastModified;
          telegramLastModifiedRef.current = serverTelegramLastModified;
          return;
        }

        // Check for new Telegram messages / reports
        if (serverTelegramLastModified > telegramLastModifiedRef.current) {
          // Invalidate all active queries to refresh dashboard data
          await queryClient.invalidateQueries();
          
          toast.info("Telegram မှ အချက်အလက်အသစ် ရရှိပါသည်", {
            description: "Dashboard ဇယားများနှင့် တွက်ချက်မှုများကို အလိုအလျောက် update လုပ်ပြီးပါပြီ။",
            duration: 4000,
          });

          // Sync refs
          lastModifiedRef.current = serverLastModified;
          telegramLastModifiedRef.current = serverTelegramLastModified;
        }
        // Check for other general updates (e.g. manual dashboard edits)
        else if (serverLastModified > lastModifiedRef.current) {
          // Invalidate silently (no toast since it's likely a user action in-app)
          await queryClient.invalidateQueries();
          lastModifiedRef.current = serverLastModified;
        }
      } catch (err) {
        console.warn("Sync polling failed:", err);
      } finally {
        isPollingRef.current = false;
      }
    }

    // Run immediately on mount
    checkSync();

    // Set up interval to poll every 10 seconds (reduces server load significantly)
    intervalId = setInterval(checkSync, 10000);

    // Run immediately when the user switches back to this tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        checkSync();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (intervalId) {
        clearInterval(intervalId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [queryClient]);
}
