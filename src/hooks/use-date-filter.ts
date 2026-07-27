"use client";

import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useState, useEffect, useCallback } from "react";

export type PeriodMode = "overall" | "day" | "month" | "year" | "custom";

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
    searchParams.get("period") === "overall"
      ? "overall"
      : searchParams.get("period") === "day"
      ? "day"
      : searchParams.get("period") === "year"
        ? "year"
        : searchParams.get("period") === "custom"
          ? "custom"
        : "month";
  const month = Math.min(
    12,
    Math.max(1, Number(searchParams.get("month") || now.getMonth() + 1))
  );
  const year = Number(searchParams.get("year") || now.getFullYear());
  const day = Math.min(
    new Date(year, month, 0).getDate(),
    Math.max(1, Number(searchParams.get("day") || now.getDate()))
  );
  const defaultCustomFrom = `${year}-${String(month).padStart(2, "0")}-01`;
  const defaultCustomTo = `${year}-${String(month).padStart(2, "0")}-${String(new Date(year, month, 0).getDate()).padStart(2, "0")}`;
  const customFrom = searchParams.get("from") || defaultCustomFrom;
  const customTo = searchParams.get("to") || defaultCustomTo;

  // ── Local mirrors for immediate UI feedback ───────────────────────────
  const [localPeriod, setLocalPeriod] = useState<PeriodMode>(period);
  const [localMonth, setLocalMonth] = useState(String(month));
  const [localYear, setLocalYear] = useState(String(year));
  const [localDay, setLocalDay] = useState(String(day));
  const [lastUrlFilter, setLastUrlFilter] = useState(() => `${period}:${month}:${day}:${year}:${customFrom}:${customTo}`);

  // Keep inputs in sync with browser navigation and direct URL changes. This
  // is intentionally derived during render so a URL change needs no extra
  // committed render followed by an effect-driven state update.
  const urlFilter = `${period}:${month}:${day}:${year}:${customFrom}:${customTo}`;
  if (lastUrlFilter !== urlFilter) {
    setLastUrlFilter(urlFilter);
    setLocalPeriod(period);
    setLocalMonth(String(month));
    setLocalDay(String(day));
    setLocalYear(String(year));
  }

  // ── URL updater ───────────────────────────────────────────────────────
  const updatePeriod = useCallback(
    (next: { period?: PeriodMode; month?: number; day?: number; year?: number; customFrom?: string; customTo?: string }) => {
      const params = new URLSearchParams(searchParams.toString());
      const nextPeriod = next.period ?? period;
      params.set("period", nextPeriod);
      if (nextPeriod === "overall") {
        params.delete("month");
        params.delete("day");
        params.delete("year");
        params.delete("from");
        params.delete("to");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        return;
      }
      if (nextPeriod === "custom") {
        const nextFrom = next.customFrom ?? customFrom;
        const nextTo = next.customTo ?? customTo;
        // Keep an invalid in-progress range from reaching data queries.
        if (nextFrom && nextTo && nextFrom > nextTo) return;
        params.set("from", nextFrom);
        params.set("to", nextTo);
        params.delete("month");
        params.delete("day");
        params.delete("year");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        return;
      }
      params.delete("from");
      params.delete("to");
      params.set("year", String(next.year ?? year));

      if (nextPeriod === "day") {
        params.set("month", String(next.month ?? month));
        params.set("day", String(next.day ?? day));
      } else if (nextPeriod === "month") {
        params.set("month", String(next.month ?? month));
        params.delete("day");
      } else {
        // A yearly view does not depend on a selected month or day.
        params.delete("month");
        params.delete("day");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, period, month, day, year, customFrom, customTo, router, pathname]
  );

  // ── sessionStorage persistence ────────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Use window.location.search for immediate browser search params on mount
    const currentParams = new URLSearchParams(window.location.search);
    if (currentParams.get("period") === "overall") {
      sessionStorage.setItem(`${storageKey}_period`, "overall");
      return;
    }
    if (currentParams.get("period") === "custom") {
      sessionStorage.setItem(`${storageKey}_period`, "custom");
      sessionStorage.setItem(`${storageKey}_from`, customFrom);
      sessionStorage.setItem(`${storageKey}_to`, customTo);
      return;
    }
    const hasPeriod = currentParams.has("period");
    const hasMonth = currentParams.has("month");
    const hasDay = currentParams.has("day");
    const hasYear = currentParams.has("year");
    const hasCompletePeriodParams =
      period === "year"
        ? hasPeriod && hasYear
        : period === "month"
          ? hasPeriod && hasMonth && hasYear
          : hasPeriod && hasMonth && hasDay && hasYear;

    if (!hasCompletePeriodParams) {
      // Restore from sessionStorage if URL is bare
      const storedPeriod = sessionStorage.getItem(
        `${storageKey}_period`
      ) as PeriodMode | null;
      const storedMonth = sessionStorage.getItem(`${storageKey}_month`);
      const storedYear = sessionStorage.getItem(`${storageKey}_year`);
      const storedDay = sessionStorage.getItem(`${storageKey}_day`);

      if (
        (storedPeriod === "overall" || storedPeriod === "day" || storedPeriod === "month" || storedPeriod === "year") &&
        storedYear &&
        (storedPeriod === "year" || Boolean(storedMonth))
      ) {
        const params = new URLSearchParams(currentParams.toString());
        params.set("period", storedPeriod);
        params.set("year", storedYear);
        if (storedPeriod === "year") {
          params.delete("month");
          params.delete("day");
        } else {
          params.set("month", storedMonth!);
          if (storedPeriod === "day") {
            params.set("day", storedDay || String(day));
          } else {
            params.delete("day");
          }
        }
        const hash = window.location.hash || "";
        router.replace(`${pathname}?${params.toString()}${hash}`, { scroll: false });
      } else {
        // First visit in this tab — seed sessionStorage with defaults
        sessionStorage.setItem(`${storageKey}_period`, period);
        sessionStorage.setItem(`${storageKey}_month`, String(month));
        sessionStorage.setItem(`${storageKey}_year`, String(year));
        sessionStorage.setItem(`${storageKey}_day`, String(day));
      }
    } else {
      // URL has all params — persist them
      sessionStorage.setItem(`${storageKey}_period`, period);
      sessionStorage.setItem(`${storageKey}_year`, String(year));
      if (period === "year") {
        sessionStorage.removeItem(`${storageKey}_month`);
        sessionStorage.removeItem(`${storageKey}_day`);
      } else {
        sessionStorage.setItem(`${storageKey}_month`, String(month));
        if (period === "day") {
          sessionStorage.setItem(`${storageKey}_day`, String(day));
        } else {
          sessionStorage.removeItem(`${storageKey}_day`);
        }
      }
    }
  }, [searchParams, pathname, router, period, month, day, year, customFrom, customTo, storageKey]);

  // ── Compute dateFrom / dateTo ─────────────────────────────────────────
  const { dateFrom, dateTo } = getPeriodRange(period, month, year, day, customFrom, customTo);

  // ── Year range for Select dropdown ────────────────────────────────────
  const years = Array.from({ length: 5 }).map(
    (_, index) => now.getFullYear() - 2 + index
  );

  return {
    period,
    month,
    day,
    customFrom,
    customTo,
    year,
    dateFrom,
    dateTo,
    localPeriod,
    localMonth,
    localYear,
    localDay,
    setLocalPeriod,
    setLocalMonth,
    setLocalYear,
    setLocalDay,
    updatePeriod,
    years,
  };
}

/** Convert period+month+year → ISO date strings. */
export function getPeriodRange(
  period: PeriodMode,
  month: number,
  year: number,
  day = 1,
  customFrom = "",
  customTo = "",
): { dateFrom: string; dateTo: string } {
  if (period === "custom") return { dateFrom: customFrom, dateTo: customTo };
  if (period === "day") {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return { dateFrom: date, dateTo: date };
  }
  if (period === "overall") {
    return { dateFrom: "", dateTo: "" };
  }
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
