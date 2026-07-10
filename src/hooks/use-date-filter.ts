"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

export type PeriodMode = "month" | "year";

/**
 * Shared date-filter hook — URL search params as source of truth,
 * with sessionStorage persistence so filters survive navigation within a
 * tab, but reset to the current month/year on a new tab or browser restart.
 *
 * @param storageKey  Unique prefix for sessionStorage keys, e.g. "dashboard_filter"
 */
export function useDateFilter(storageKey: string) {
  const now = new Date();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // ── Derive from URL ───────────────────────────────────────────────────
  const period: PeriodMode =
    searchParams.get("period") === "year" ? "year" : "month";
  const month = Math.min(
    12,
    Math.max(1, Number(searchParams.get("month") || now.getMonth() + 1))
  );
  const year = Number(searchParams.get("year") || now.getFullYear());

  // ── Local mirrors for immediate UI feedback ───────────────────────────
  const [localPeriod, setLocalPeriod] = useState<PeriodMode>(period);
  const [localMonth, setLocalMonth] = useState(String(month));
  const [localYear, setLocalYear] = useState(String(year));
  const [lastUrlFilter, setLastUrlFilter] = useState(() => `${period}:${month}:${year}`);

  // Keep inputs in sync with browser navigation and direct URL changes. This
  // is intentionally derived during render so a URL change needs no extra
  // committed render followed by an effect-driven state update.
  const urlFilter = `${period}:${month}:${year}`;
  if (lastUrlFilter !== urlFilter) {
    setLastUrlFilter(urlFilter);
    setLocalPeriod(period);
    setLocalMonth(String(month));
    setLocalYear(String(year));
  }

  // ── URL updater ───────────────────────────────────────────────────────
  const updatePeriod = useCallback(
    (next: { period?: PeriodMode; month?: number; year?: number }) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("period", next.period ?? period);
      params.set("month", String(next.month ?? month));
      params.set("year", String(next.year ?? year));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, period, month, year, router, pathname]
  );

  // ── sessionStorage persistence ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Use window.location.search for immediate browser search params on mount
    const currentParams = new URLSearchParams(window.location.search);
    const hasPeriod = currentParams.has("period");
    const hasMonth = currentParams.has("month");
    const hasYear = currentParams.has("year");

    if (!hasPeriod || !hasMonth || !hasYear) {
      // Restore from sessionStorage if URL is bare
      const storedPeriod = sessionStorage.getItem(
        `${storageKey}_period`
      ) as PeriodMode | null;
      const storedMonth = sessionStorage.getItem(`${storageKey}_month`);
      const storedYear = sessionStorage.getItem(`${storageKey}_year`);

      if (
        (storedPeriod === "month" || storedPeriod === "year") &&
        storedMonth &&
        storedYear
      ) {
        const params = new URLSearchParams(currentParams.toString());
        params.set("period", storedPeriod);
        params.set("month", storedMonth);
        params.set("year", storedYear);
        const hash = window.location.hash || "";
        router.replace(`${pathname}?${params.toString()}${hash}`, { scroll: false });
      } else {
        // First visit in this tab — seed sessionStorage with defaults
        sessionStorage.setItem(`${storageKey}_period`, period);
        sessionStorage.setItem(`${storageKey}_month`, String(month));
        sessionStorage.setItem(`${storageKey}_year`, String(year));
      }
    } else {
      // URL has all params — persist them
      sessionStorage.setItem(`${storageKey}_period`, period);
      sessionStorage.setItem(`${storageKey}_month`, String(month));
      sessionStorage.setItem(`${storageKey}_year`, String(year));
    }
  }, [searchParams, pathname, router, period, month, year, storageKey]);

  // ── Compute dateFrom / dateTo ─────────────────────────────────────────
  const { dateFrom, dateTo } = getPeriodRange(period, month, year);

  // ── Year range for Select dropdown ────────────────────────────────────
  const years = Array.from({ length: 5 }).map(
    (_, index) => now.getFullYear() - 2 + index
  );

  return {
    period,
    month,
    year,
    dateFrom,
    dateTo,
    localPeriod,
    localMonth,
    localYear,
    setLocalPeriod,
    setLocalMonth,
    setLocalYear,
    updatePeriod,
    years,
  };
}

/** Convert period+month+year → ISO date strings. */
export function getPeriodRange(
  period: PeriodMode,
  month: number,
  year: number
): { dateFrom: string; dateTo: string } {
  if (period === "year") {
    return {
      dateFrom: `${year}-01-01`,
      dateTo: `${year}-12-31`,
    };
  }
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    dateFrom: `${year}-${mm}-01`,
    dateTo: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}
