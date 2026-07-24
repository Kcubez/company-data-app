'use client';

import { Suspense, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useSession } from '@/lib/auth-client';
import { useDateFilter, type PeriodMode } from '@/hooks/use-date-filter';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalPortal } from '@/components/ui/modal-portal';
import { toast } from 'sonner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Users,
  TrendingUp,
  Bot,
  Banknote,
  Wallet,
  Megaphone,
  CalendarCheck,
  AlertTriangle,
  Award,
  DollarSign,
  Phone,
  Server,
  BarChart3,
  LineChart,
  Trophy,
  Target,
  Loader2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ChartDatum = Record<string, unknown>;

type WeeklyActivity = {
  date: string;
  count: number;
};

type FinancialTrend = {
  label: string;
  revenue: number;
  expense: number;
  demand: number;
  profit: number;
};

type TopProduct = {
  product: string;
  count: number;
  totalQty: number;
  revenue: number;
};

type DueTodayRecord = {
  id: string;
  customerName: string | null;
  product: string | null;
  quantity: number | null;
  status: string;
  note: string;
  senderName: string;
  followUpDate: string | null;
};


type DashboardStats = {
  totalMessages: number;
  todayMessages: number;
  totalSenders: number;
  weekMessages: number;
  todayDemandRecords: number;
  dueTodayFollowUps: number;
  pendingDemandRecords: number;
  totalCustomers: number;
  newCustomers: number;
  botActive: boolean;
  recentMessages: {
    id: string;
    text: string;
    senderName: string;
    senderUsername: string | null;
    receivedAt: string;
  }[];
  isAdmin: boolean;
  adminStats: {
    totalUsers: number;
    activeSessions: number;
  } | null;
  totalQuantitySold: number;
  totalAmountSold: number;
  totalCost: number;
  profitLoss: number;
  roi: number | null;
  period: PeriodMode;
  selectedMonth: number;
  selectedYear: number;
  highPriorityLeads: number;
  missingPhoneLeads: number;
  weeklyActivity: WeeklyActivity[];
  topProducts: TopProduct[];
  dueTodayRecords: DueTodayRecord[];
  targetDemandCount: number | null;
  targetAppointments: number | null;
  targetSalesAmount: number | null;
  targetExpenseAmount: number | null;
  targetNewCustomers: number | null;
  actualRevenue: number;
  actualDemandCount: number;
  actualAppointments: number;
  expectedRevenue: number | null;
  expectedExpense: number | null;
  expectedDemandCount: number | null;
  expectedAppointments: number | null;
  expectedNewCustomers: number | null;
  elapsedRatio: number;
  elapsedDays: number;
  totalDaysInPeriod: number;
  financialTrend: FinancialTrend[];
  salesFunnel: {
    leads: number;
    appointments: number;
    closedDeals: number;
    appointmentConversionRate: number | null;
    closeConversionRate: number | null;
  };
  risks: {
    overdueFollowUps: number;
    highPriorityLeads: number;
    missingPhoneLeads: number;
    dueTodayFollowUps: number;
  };
  alerts: {
    type: 'revenue_target' | 'demand_target' | 'appointments_target' | 'expense_target' | 'customers_target';
    status: 'warning' | 'info';
    message: string;
    actual: number;
    expected: number;
    target: number;
  }[];
};

function useDashboardStats(period: PeriodMode, month: number, day: number, year: number) {
  return useQuery({
    queryKey: ['dashboard-stats', period, month, day, year],
    queryFn: async (): Promise<DashboardStats> => {
      const res = await fetch(`/api/dashboard/stats?period=${period}&month=${month}&day=${day}&year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 10000,
  });
}

type ActionRecommendation = {
  area: 'marketing' | 'sales' | 'appointments' | 'general';
  severity: 'urgent' | 'warning' | 'info';
  title: string;
  insight: string;
  action: string;
  actionType:
    | 'view_quoted_deals'
    | 'view_pending_deals'
    | 'view_all_deals'
    | 'view_overdue_followups'
    | 'view_due_followups'
    | 'view_missing_phone'
    | 'set_target_modal'
    | 'view_finance'
    | 'general_dashboard';
};

function useActionRecommendations(period: PeriodMode, month: number, day: number, year: number) {
  return useQuery({
    queryKey: ['action-recommendations', period, month, day, year],
    queryFn: async (): Promise<{ recommendations: ActionRecommendation[] }> => {
      const res = await fetch(`/api/dashboard/action-recommendations?period=${period}&month=${month}&day=${day}&year=${year}`);
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    // Refresh every 2 minutes so newly imported demand records / business reports
    // are reflected quickly without hammering Gemini on every 10s poll.
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
  });
}


function PremiumLineChart({ data, valueKey, labelKey, totalDays = 30, elapsedDays = totalDays, period = 'month', seriesLabel = 'Income (MMK)', color = '#0ea5e9' }: { data: ChartDatum[], valueKey: string, labelKey: string, totalDays?: number, elapsedDays?: number, period?: string, seriesLabel?: string, color?: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const isYearly = period === 'year';
  const isAggregated = period === 'year' || period === 'overall';
  const tickCount = period === 'overall' ? data.length : isYearly ? 12 : totalDays;

  if (!data || data.length === 0) {
    return <div className="text-sm text-muted-foreground py-10 text-center">No data available</div>;
  }

  const paddingLeft = 70;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartWidth = 700;
  const chartHeight = 220;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  const displayData = period === 'month' && elapsedDays > 0 && elapsedDays < totalDays ? data.slice(0, elapsedDays) : data;
  const values = displayData.map(d => Number(d[valueKey]) || 0);
  const hasData = values.some((value) => value !== 0);

  if (!hasData) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-400">
        No {seriesLabel.toLowerCase()} data for this period
      </div>
    );
  }

  const maxValue = Math.max(...values, 1);
  const initialMax = Math.ceil(maxValue * 1.15);
  const yStep = Math.max(1, Math.ceil(initialMax / 5));
  const roundedMax = yStep * 5;

  // Once a period has data, zeroes are meaningful values and remain on the line.
  // The empty-state guard above handles periods with no values at all.
  const validData = displayData;

  const getDay = (label: string) => {
    if (!label) return 1;
    if (!isNaN(Number(label))) return Number(label);
    const parts = label.split('-');
    if (parts.length >= 3) return Number(parts[2]);
    return 1;
  };

  const points = validData.map((d) => {
    // In yearly mode, use index-based positioning (0..11 for 12 months)
    // In monthly mode, use day-based positioning
    const label = String(d[labelKey] ?? '');
    const posIndex = isAggregated ? data.indexOf(d) : getDay(label) - 1;
    const x = paddingLeft + (posIndex / (tickCount - 1 || 1)) * plotWidth;
    const y = paddingTop + plotHeight - ((Number(d[valueKey]) || 0) / roundedMax) * plotHeight;
    return { x, y, value: d[valueKey], label, day: isAggregated ? label : getDay(label) };
  });

  // Create smooth SVG path (cubic bezier for tension like Chart.js tension:0.3)
  let pathD = '';
  let areaD = '';
  if (points.length > 0) {
    pathD = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const cp1x = prev.x + (curr.x - prev.x) * 0.3;
      const cp2x = curr.x - (curr.x - prev.x) * 0.3;
      pathD += ` C ${cp1x} ${prev.y}, ${cp2x} ${curr.y}, ${curr.x} ${curr.y}`;
    }
    areaD = `${pathD} L ${points[points.length - 1].x} ${paddingTop + plotHeight} L ${points[0].x} ${paddingTop + plotHeight} Z`;
  }

  // Y axis ticks (6 ticks)
  const yTicks = Array.from({ length: 6 }).map((_, i) => {
    const val = yStep * i;
    const y = paddingTop + plotHeight - (val / roundedMax) * plotHeight;
    return { val, y };
  });

  // X axis ticks
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const xTicks = Array.from({ length: tickCount }).map((_, i) => {
    const x = paddingLeft + (i / (tickCount - 1 || 1)) * plotWidth;
    const label = period === 'overall' ? String(data[i]?.[labelKey] ?? '') : isYearly ? monthLabels[i] || '' : String(i + 1);
    return { x, label };
  });

  return (
    <div className="relative w-full mt-4 select-none">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 20}`} className="w-full overflow-visible" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.12" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>

        {/* Horizontal Grid lines */}
        {yTicks.map((tick, i) => (
          <g key={`y-${i}`}>
            <line
              x1={paddingLeft}
              y1={tick.y}
              x2={chartWidth - paddingRight}
              y2={tick.y}
              stroke="#f1f5f9"
              className="dark:stroke-slate-800"
              strokeWidth="1"
            />
            <text
              x={paddingLeft - 8}
              y={tick.y + 4}
              textAnchor="end"
              className="fill-slate-500 dark:fill-slate-400"
              style={{ fontSize: '9px', fontFamily: "'Inter', sans-serif" }}
            >
              {tick.val.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}

        {/* Vertical Grid lines */}
        {xTicks.map((tick, i) => (
          <line
            key={`x-${i}`}
            x1={tick.x}
            y1={paddingTop}
            x2={tick.x}
            y2={paddingTop + plotHeight}
            stroke="#f1f5f9"
            className="dark:stroke-slate-800"
            strokeWidth="1"
          />
        ))}

        {/* X axis line */}
        <line
          x1={paddingLeft}
          y1={paddingTop + plotHeight}
          x2={chartWidth - paddingRight}
          y2={paddingTop + plotHeight}
          stroke="#f1f5f9"
          className="dark:stroke-slate-700"
          strokeWidth="1"
        />

        {/* X labels */}
        {xTicks.map((tick, i) => (
          <text
            key={i}
            x={tick.x}
            y={paddingTop + plotHeight + 15}
            textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400"
            style={{ fontSize: '9px', fontFamily: "'Inter', sans-serif" }}
          >
            {tick.label}
          </text>
        ))}

        {/* X axis title */}
        <text
          x={paddingLeft + plotWidth / 2}
          y={paddingTop + plotHeight + 30}
          textAnchor="middle"
          className="fill-slate-500 dark:fill-slate-400"
          style={{ fontSize: '10px', fontWeight: 700, fontFamily: "'Inter', sans-serif" }}
        >
          {period === 'overall' ? 'Year' : isYearly ? 'Month' : 'Day of Month'}
        </text>

        {/* Area fill */}
        {areaD && <path d={areaD} fill="url(#lineGrad)" />}

        {/* The line */}
        {pathD && (
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Data points */}
        {points.map((p, idx) => (
          <g key={idx}>
            {hoveredIndex === idx && (
              <>
                <line x1={p.x} y1={paddingTop} x2={p.x} y2={paddingTop + plotHeight} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3" />
                <circle cx={p.x} cy={p.y} r="5" fill={color} stroke="white" strokeWidth="2" />
              </>
            )}
            <circle cx={p.x} cy={p.y} r="3" fill={color} stroke="white" strokeWidth="1.5" />
          </g>
        ))}

        {/* Hover detection zones */}
        {points.map((p, idx) => {
          const zoneWidth = plotWidth / (tickCount - 1 || 1);
          return (
            <rect key={idx} x={p.x - zoneWidth / 2} y={paddingTop} width={zoneWidth} height={plotHeight}
              fill="transparent" className="cursor-pointer"
              onMouseEnter={() => setHoveredIndex(idx)} onMouseLeave={() => setHoveredIndex(null)}
            />
          );
        })}
      </svg>

      {/* Chart.js-style tooltip */}
      {hoveredIndex !== null && points[hoveredIndex] && (
        <div
          className="absolute pointer-events-none z-20"
          style={{
            left: `${((points[hoveredIndex].x - paddingLeft) / plotWidth) * 100}%`,
            top: `${Math.max(2, ((points[hoveredIndex].y - paddingTop) / plotHeight) * 65)}%`,
            transform: 'translateX(-50%)',
            marginLeft: `${paddingLeft / chartWidth * 100}%`,
          }}
        >
          <div className="bg-slate-800/95 dark:bg-slate-900/95 text-white text-[11px] px-3 py-2 rounded-md shadow-lg backdrop-blur-sm" style={{ fontFamily: "'Inter', sans-serif" }}>
            <div className="font-bold mb-1">{points[hoveredIndex].label}</div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: color }} />
              <span className="text-slate-300">{period === 'overall' ? 'Yearly' : isYearly ? 'Monthly' : 'Daily'} {seriesLabel}:</span>
              <span className="font-semibold">{Number(points[hoveredIndex].value).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PremiumBarChart({ data, valueKey, labelKey, totalDays = 30, elapsedDays = totalDays, period = 'month' }: { data: ChartDatum[], valueKey: string, labelKey: string, totalDays?: number, elapsedDays?: number, period?: string }) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const isYearly = period === 'year';
  const isAggregated = period === 'year' || period === 'overall';
  const tickCount = period === 'overall' ? data.length : isYearly ? 12 : totalDays;

  if (!data || data.length === 0) {
    return <div className="text-sm text-muted-foreground py-10 text-center">No data available</div>;
  }

  const paddingLeft = 50;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;
  const chartWidth = 700;
  const chartHeight = 220;
  const plotWidth = chartWidth - paddingLeft - paddingRight;
  const plotHeight = chartHeight - paddingTop - paddingBottom;

  const displayData = period === 'month' && elapsedDays > 0 && elapsedDays < totalDays ? data.slice(0, elapsedDays) : data;
  const values = displayData.map(d => Number(d[valueKey]) || 0);
  const hasData = values.some((value) => value !== 0);

  if (!hasData) {
    return (
      <div className="flex h-[240px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/60 text-sm font-medium text-slate-500 dark:border-slate-800 dark:bg-slate-900/30 dark:text-slate-400">
        No demand data for this period
      </div>
    );
  }

  const maxValue = Math.max(...values, 1);
  const initialMax = Math.ceil(maxValue * 1.15);
  const yStep = Math.max(1, Math.ceil(initialMax / 5));
  const roundedMax = yStep * 5;

  const getDay = (label: string) => {
    if (!label) return 1;
    if (!isNaN(Number(label))) return Number(label);
    const parts = label.split('-');
    if (parts.length >= 3) return Number(parts[2]);
    return 1;
  };

  // Slot width per tick (uniform across all buckets)
  const slotWidth = plotWidth / tickCount;
  const barWidth = Math.max(6, slotWidth * 0.65);

  const points = displayData.map((d, idx) => {
    // In yearly mode, use index-based positioning (0..11)
    // In monthly mode, use day-based positioning
    const label = String(d[labelKey] ?? '');
    const posIndex = isAggregated ? idx : getDay(label) - 1;
    const slotX = paddingLeft + posIndex * slotWidth;
    const x = slotX + (slotWidth - barWidth) / 2;
    const heightVal = ((Number(d[valueKey]) || 0) / roundedMax) * plotHeight;
    const y = paddingTop + plotHeight - heightVal;
    return { x, y, heightVal, value: d[valueKey], label, day: isAggregated ? label : getDay(label), slotX };
  });

  // Y axis ticks (6 ticks)
  const yTicks = Array.from({ length: 6 }).map((_, i) => {
    const val = yStep * i;
    const y = paddingTop + plotHeight - (val / roundedMax) * plotHeight;
    return { val, y };
  });

  // X axis ticks
  const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const xTicks = Array.from({ length: tickCount }).map((_, i) => {
    const cx = paddingLeft + i * slotWidth + slotWidth / 2;
    const label = period === 'overall' ? String(data[i]?.[labelKey] ?? '') : isYearly ? monthLabels[i] || '' : String(i + 1);
    return { x: cx, label };
  });

  return (
    <div className="relative w-full mt-4 select-none">
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 20}`} className="w-full overflow-visible" style={{ display: 'block' }} preserveAspectRatio="xMidYMid meet">
        {/* Horizontal Grid lines */}
        {yTicks.map((tick, i) => (
          <g key={`y-${i}`}>
            <line x1={paddingLeft} y1={tick.y} x2={chartWidth - paddingRight} y2={tick.y}
              stroke="#f1f5f9" className="dark:stroke-slate-800" strokeWidth="1" />
            <text x={paddingLeft - 8} y={tick.y + 4} textAnchor="end"
              className="fill-slate-500 dark:fill-slate-400"
              style={{ fontSize: '9px', fontFamily: "'Inter', sans-serif" }}>
              {tick.val.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </text>
          </g>
        ))}

        {/* Vertical Grid lines */}
        {xTicks.map((tick, i) => (
          <line key={`x-${i}`} x1={tick.x} y1={paddingTop} x2={tick.x} y2={paddingTop + plotHeight}
            stroke="#f1f5f9" className="dark:stroke-slate-800" strokeWidth="1" />
        ))}

        {/* X axis line */}
        <line x1={paddingLeft} y1={paddingTop + plotHeight} x2={chartWidth - paddingRight} y2={paddingTop + plotHeight}
          stroke="#f1f5f9" className="dark:stroke-slate-700" strokeWidth="1" />

        {/* X labels */}
        {xTicks.map((tick, i) => (
          <text key={i} x={tick.x} y={paddingTop + plotHeight + 15} textAnchor="middle"
            className="fill-slate-500 dark:fill-slate-400"
            style={{ fontSize: '8px', fontFamily: "'Inter', sans-serif" }}>
            {tick.label}
          </text>
        ))}

        {/* X axis title */}
        <text x={paddingLeft + plotWidth / 2} y={paddingTop + plotHeight + 30} textAnchor="middle"
          className="fill-slate-500 dark:fill-slate-400"
          style={{ fontSize: '10px', fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>
          {period === 'overall' ? 'Year' : isYearly ? 'Month' : 'Day of Month'}
        </text>

        {/* Bars — top-only rounded corners */}
        {points.map((p, idx) => {
          const h = Math.max(1, p.heightVal);
          const r = Math.min(4, barWidth / 2, h);
          const barPath = `M ${p.x} ${p.y + h} V ${p.y + r} Q ${p.x} ${p.y} ${p.x + r} ${p.y} H ${p.x + barWidth - r} Q ${p.x + barWidth} ${p.y} ${p.x + barWidth} ${p.y + r} V ${p.y + h} Z`;
          return (
            <path key={idx} d={barPath} fill="#8b5cf6"
              opacity={hoveredIndex === idx ? 1 : 0.85}
            />
          );
        })}

        {/* Hover detection zones */}
        {points.map((p, idx) => (
          <rect key={`hz-${idx}`} x={p.slotX} y={paddingTop} width={slotWidth} height={plotHeight}
            fill="transparent" className="cursor-pointer"
            onMouseEnter={() => setHoveredIndex(idx)} onMouseLeave={() => setHoveredIndex(null)}
          />
        ))}
      </svg>

      {/* Chart.js-style tooltip */}
      {hoveredIndex !== null && points[hoveredIndex] && (
        <div
          className="absolute pointer-events-none z-20"
          style={{
            left: `${((points[hoveredIndex].x + barWidth / 2 - paddingLeft) / plotWidth) * 100}%`,
            top: `${Math.max(2, ((points[hoveredIndex].y - paddingTop) / plotHeight) * 60)}%`,
            transform: 'translateX(-50%)',
            marginLeft: `${paddingLeft / chartWidth * 100}%`,
          }}
        >
          <div className="bg-slate-800/95 dark:bg-slate-900/95 text-white text-[11px] px-3 py-2 rounded-md shadow-lg backdrop-blur-sm" style={{ fontFamily: "'Inter', sans-serif" }}>
            <div className="font-bold mb-1">{points[hoveredIndex].label}</div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm bg-violet-500 inline-block" />
              <span className="text-slate-300">{period === 'overall' ? 'Yearly' : isYearly ? 'Monthly' : 'Daily'} Demands:</span>
              <span className="font-semibold">{Number(points[hoveredIndex].value).toLocaleString()}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ProgressCard({
  title, statusLabel, statusColor,
  value, maxValue, valueSuffix,
  actualDetail,
  expectedLabel, expectedValue,
  actualPct, timePct, barColor, icon: Icon
}: {
  title: string; statusLabel: string; statusColor: string;
  value: number | string; maxValue?: number | string; valueSuffix?: string; actualDetail?: string;
  expectedLabel: string; expectedValue: number | string;
  actualPct: number; timePct: number; barColor: string; icon: LucideIcon;
}) {
  return (
    <div className="bg-card dark:bg-slate-900/40 border-2 border-slate-300 dark:border-slate-800 p-6 flex flex-col justify-between h-48 rounded-xl shadow-sm hover:shadow-lg hover:-translate-y-0.5 hover:border-slate-400 dark:hover:border-slate-700 transition-all duration-200">
      <div className="flex justify-between items-center">
        <h4 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{title}</h4>
        <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800/80 flex items-center justify-center text-slate-400 dark:text-slate-500">
          {Icon && <Icon className="w-4 h-4" />}
        </div>
      </div>
      
      <div>
        <div className="flex items-baseline gap-2">
          <h3 className="text-3xl font-extrabold text-slate-800 dark:text-slate-100 tracking-tight font-sans">{value}</h3>
          {maxValue && (
            <p className="text-sm text-slate-400 dark:text-slate-500 font-medium font-sans">
              / {maxValue}{valueSuffix ? ` ${valueSuffix}` : ''}
            </p>
          )}
        </div>
        {actualDetail && <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">Actual: {actualDetail}</p>}
      </div>

      <div className="relative w-full h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full border border-slate-200 dark:border-slate-700 shadow-inner overflow-visible">
        {/* Pacing Marker */}
        <div 
          className="absolute top-[-4px] bottom-[-4px] w-[2px] bg-slate-800 dark:bg-slate-200 z-10 rounded" 
          style={{ left: `${Math.min(100, Math.max(0, timePct))}%` }}
        />
        {/* Actual progress */}
        <div 
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-500 ease-out"
          style={{ 
            width: `${Math.min(100, Math.max(0, actualPct))}%`,
            backgroundColor: barColor
          }}
        />
      </div>

      <div className="flex justify-between items-center text-xs font-bold">
        <span className="text-slate-500 dark:text-slate-400 font-sans">
          {expectedLabel}: {expectedValue}
        </span>
        <span style={{ color: statusColor }}>{statusLabel}</span>
      </div>
    </div>
  );
}

function getPacingStatus(actual: number, expected: number, isInverse = false): { label: string; color: string; barColor: string } {
  if (isInverse) {
    // For expenses: lower is better
    if (actual <= expected) return { label: 'On Track', color: '#16a34a', barColor: '#22c55e' };
    if (actual <= expected * 1.15) return { label: 'Near Target', color: '#d97706', barColor: '#f59e0b' };
    return { label: 'Below Target', color: '#dc2626', barColor: '#ef4444' };
  }
  // For revenue, demand, appointments, customers: higher is better
  if (actual >= expected) return { label: 'On Track', color: '#16a34a', barColor: '#22c55e' };
  if (actual >= expected * 0.85) return { label: 'Near Target', color: '#d97706', barColor: '#f59e0b' };
  return { label: 'Below Target', color: '#dc2626', barColor: '#ef4444' };
}

function formatOverviewAmount(amount: number) {
  return (Math.round(amount / 100_000) * 100_000).toLocaleString();
}

function DashboardPageContent() {
  const { data: session } = useSession();
  const {
    period,
    month,
    day,
    year,
    localPeriod,
    localMonth,
    localYear,
    setLocalPeriod,
    setLocalMonth,
    setLocalYear,
    updatePeriod,
    years,
  } = useDateFilter('dashboard_filter');

  const { data: stats, isLoading } = useDashboardStats(period, month, day, year);
  const { data: recsData, isLoading: recsLoading } = useActionRecommendations(period, month, day, year);
  const router = useRouter();

  useEffect(() => {
    if (session?.user.role === 'admin') {
      router.replace('/admin/users');
    }
  }, [router, session?.user.role]);

  const getActionLink = (rec: ActionRecommendation) => {
    // 1. Prioritize actionType if present
    if (rec.actionType) {
      switch (rec.actionType) {
        case 'view_quoted_deals':
          return "/sales-marketing?status=quoted#report-table-section";
        case 'view_pending_deals':
          return "/sales-marketing?status=pending#report-table-section";
        case 'view_all_deals':
          return "/sales-marketing#report-table-section";
        case 'view_overdue_followups':
          return "/customer-service?followUpStatus=overdue#demand-leads-section";
        case 'view_due_followups':
          return "/customer-service?followUpStatus=due#demand-leads-section";
        case 'view_missing_phone':
          return "/sales-marketing?missingField=phone#report-table-section";
        case 'view_finance':
          return "/finance";
        case 'set_target_modal':
          return "/dashboard";
        case 'general_dashboard':
        default:
          return "/dashboard";
      }
    }

    // 2. Heuristic fallback (old keyword check) in case actionType is not populated
    const searchStr = `${rec.title} ${rec.action} ${rec.insight}`.toLowerCase();

    // 1. High-Potential Leads
    if (searchStr.includes("high-potential") || searchStr.includes("priority")) {
      return "/sales-marketing?priority=high#report-table-section";
    }
    // 2. Overdue or due followups
    if (searchStr.includes("follow-up") || searchStr.includes("သက်တမ်းကျော်")) {
      return "/customer-service?followUpStatus=overdue#demand-leads-section";
    }
    if (searchStr.includes("ယနေ့ follow-up") || searchStr.includes("ယနေ့")) {
      return "/customer-service?followUpStatus=due#demand-leads-section";
    }
    // 3. Missing Phone Number
    if (searchStr.includes("ဖုန်းနံပါတ်") || searchStr.includes("phone")) {
      return "/sales-marketing?missingField=phone#report-table-section";
    }
    // 4. Closeable/Pending Deals
    if (searchStr.includes("deal") || searchStr.includes("ပိတ်နိုင်") || searchStr.includes("ပိတ်ဆင်း")) {
      if (searchStr.includes("pending") || searchStr.includes("ဆိုင်းငံ့")) {
        return "/sales-marketing?status=pending#report-table-section";
      }
      return "/sales-marketing?status=quoted#report-table-section";
    }
    // 5. Sales activity / Daily workflow
    if (
      searchStr.includes("လုပ်ဆောင်ချက်") || 
      searchStr.includes("စွမ်းဆောင်ရည်") || 
      searchStr.includes("workflow") || 
      searchStr.includes("activity")
    ) {
      return "/finance";
    }
    // 6. Revenue target gap
    if (searchStr.includes("အရောင်းဝင်ငွေ") || searchStr.includes("sales") || searchStr.includes("revenue")) {
      return "/finance";
    }
    // Fallbacks
    if (rec.area === "sales" || rec.area === "marketing") return "/sales-marketing";
    if (rec.area === "appointments") return "/customer-service";
    return "/dashboard";
  };

  const queryClient = useQueryClient();
  const [isTargetModalOpen, setIsTargetModalOpen] = useState(false);
  const [isSavingTarget, setIsSavingTarget] = useState(false);
  const [targetForm, setTargetForm] = useState({
    targetSalesAmount: '',
    targetExpenseAmount: '',
    targetDemandCount: '',
    targetAppointments: '',
    targetNewCustomers: '',
  });

  useEffect(() => {
    if (stats) {
      setTargetForm({
        targetSalesAmount: stats.targetSalesAmount !== null ? String(stats.targetSalesAmount) : '',
        targetExpenseAmount: stats.targetExpenseAmount !== null ? String(stats.targetExpenseAmount) : '',
        targetDemandCount: stats.targetDemandCount !== null ? String(stats.targetDemandCount) : '',
        targetAppointments: stats.targetAppointments !== null ? String(stats.targetAppointments) : '',
        targetNewCustomers: stats.targetNewCustomers !== null ? String(stats.targetNewCustomers) : '',
      });
    }
  }, [stats]);

  const handleSaveTargets = async () => {
    setIsSavingTarget(true);
    try {
      const res = await fetch('/api/settings/target', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period,
          year,
          month: period === 'year' ? 0 : month,
          targetSalesAmount: targetForm.targetSalesAmount === '' ? null : Number(targetForm.targetSalesAmount),
          targetExpenseAmount: targetForm.targetExpenseAmount === '' ? null : Number(targetForm.targetExpenseAmount),
          targetDemandCount: targetForm.targetDemandCount === '' ? null : Number(targetForm.targetDemandCount),
          targetAppointments: targetForm.targetAppointments === '' ? null : Number(targetForm.targetAppointments),
          targetNewCustomers: targetForm.targetNewCustomers === '' ? null : Number(targetForm.targetNewCustomers),
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.message || 'Failed to save targets');
      }

      toast.success('Targets updated successfully');
      setIsTargetModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats', period, month, year] });
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to save targets');
    } finally {
      setIsSavingTarget(false);
    }
  };

  const timePct = stats?.elapsedRatio ? stats.elapsedRatio * 100 : 0;
  
  // Calculations for cards
  const hasRevenueTarget = stats?.targetSalesAmount !== null && stats?.targetSalesAmount !== undefined;
  const revenueTarget = hasRevenueTarget ? stats.targetSalesAmount! : 0;
  const revenueValue = stats?.totalAmountSold || 0;
  const revenueActualPct = revenueTarget > 0 ? (revenueValue / revenueTarget) * 100 : 0;
  const revenueExpected = stats?.expectedRevenue || 0;
  const revenuePacing = hasRevenueTarget ? getPacingStatus(revenueValue, revenueExpected) : { label: 'Not Set', color: '#64748b', barColor: '#94a3b8' };

  const hasExpenseTarget = stats?.targetExpenseAmount !== null && stats?.targetExpenseAmount !== undefined;
  const expenseTarget = hasExpenseTarget ? stats.targetExpenseAmount! : 0;
  const expenseValue = stats?.totalCost || 0;
  const expenseActualPct = expenseTarget > 0 ? (expenseValue / expenseTarget) * 100 : 0;
  const expenseExpected = stats?.expectedExpense || 0;
  const expensePacing = hasExpenseTarget ? getPacingStatus(expenseValue, expenseExpected, true) : { label: 'Not Set', color: '#64748b', barColor: '#94a3b8' };

  const hasProfitTarget = hasRevenueTarget && hasExpenseTarget;
  const profitTarget = revenueTarget - expenseTarget;
  const profitValue = stats?.profitLoss || 0;
  const profitMarginPercent = revenueValue > 0 ? (profitValue / revenueValue) * 100 : 0;
  const targetMarginPct = revenueTarget > 0 ? (profitTarget / revenueTarget) * 100 : 0;
  const profitPacing = hasProfitTarget ? getPacingStatus(profitMarginPercent, targetMarginPct) : { label: 'Not Set', color: '#64748b', barColor: '#94a3b8' };

  const hasDemandTarget = stats?.targetDemandCount !== null && stats?.targetDemandCount !== undefined;
  const demandTarget = hasDemandTarget ? stats.targetDemandCount! : 0;
  const demandValue = stats?.actualDemandCount || 0;
  const demandActualPct = demandTarget > 0 ? (demandValue / demandTarget) * 100 : 0;
  const demandExpected = stats?.expectedDemandCount || 0;
  const demandPacing = hasDemandTarget ? getPacingStatus(demandValue, demandExpected) : { label: 'Not Set', color: '#64748b', barColor: '#94a3b8' };

  const hasApptTarget = stats?.targetAppointments !== null && stats?.targetAppointments !== undefined;
  const apptTarget = hasApptTarget ? stats.targetAppointments! : 0;
  const apptValue = stats?.actualAppointments || 0;
  const apptActualPct = apptTarget > 0 ? (apptValue / apptTarget) * 100 : 0;
  const apptExpected = stats?.expectedAppointments || 0;
  const apptPacing = hasApptTarget ? getPacingStatus(apptValue, apptExpected) : { label: 'Not Set', color: '#64748b', barColor: '#94a3b8' };

  const hasCustomerTarget = stats?.targetNewCustomers !== null && stats?.targetNewCustomers !== undefined;
  const customerTarget = hasCustomerTarget ? stats.targetNewCustomers! : 0;
  const customerValue = stats?.newCustomers || 0;
  const customerActualPct = customerTarget > 0 ? (customerValue / customerTarget) * 100 : 0;
  const customerExpected = stats?.expectedNewCustomers || 0;
  const customerPacing = hasCustomerTarget ? getPacingStatus(customerValue, customerExpected) : { label: 'Not Set', color: '#64748b', barColor: '#94a3b8' };

  const elapsedDaysText = stats?.elapsedDays ? ` (Day ${stats.elapsedDays})` : '';

  if (session?.user.role === 'admin') {
    return <div className="space-y-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>;
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-1 font-heading">
            Business Overview
          </h1>
          <p className="text-muted-foreground text-sm">
            Daily intelligence feed and target pacing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Select value={localPeriod} onValueChange={(value) => {
            if (value === 'overall' || value === 'day' || value === 'month' || value === 'year') {
              setLocalPeriod(value);
              updatePeriod({ period: value });
            }
          }}>
            <SelectTrigger className="h-9 w-28 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
              {localPeriod === 'overall' ? 'Overall' : localPeriod === 'year' ? 'Yearly' : localPeriod === 'day' ? 'Daily' : 'Monthly'}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="overall">Overall</SelectItem>
              <SelectItem value="day">Daily</SelectItem>
              <SelectItem value="month">Monthly</SelectItem>
              <SelectItem value="year">Yearly</SelectItem>
            </SelectContent>
          </Select>
          {localPeriod === 'day' ? (
            <Input
              type="date"
              value={`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`}
              onChange={(event) => {
                const next = new Date(`${event.target.value}T00:00:00`);
                if (!Number.isNaN(next.getTime())) updatePeriod({ year: next.getFullYear(), month: next.getMonth() + 1, day: next.getDate() });
              }}
              className="h-9 w-40 rounded-lg border-2 border-slate-300 bg-card text-xs font-bold dark:border-slate-800"
              aria-label="Select day"
            />
          ) : localPeriod === 'month' ? (
            <Select value={localMonth} onValueChange={(value) => {
              if (value) {
                setLocalMonth(value);
                updatePeriod({ month: Number(value) });
              }
            }}>
              <SelectTrigger className="h-9 w-32 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
                {new Date(Number(localYear), Number(localMonth) - 1, 1).toLocaleString('en', { month: 'long' })}
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 12 }).map((_, index) => (
                  <SelectItem key={index + 1} value={String(index + 1)}>
                    {new Date(Number(localYear), index, 1).toLocaleString('en', { month: 'long' })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          {localPeriod !== 'day' && localPeriod !== 'overall' && <Select value={localYear} onValueChange={(value) => {
            if (value) {
              setLocalYear(value);
              updatePeriod({ year: Number(value) });
            }
          }}>
            <SelectTrigger className="h-9 w-24 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card text-xs font-bold text-slate-800 dark:text-slate-200">
              {localYear}
            </SelectTrigger>
            <SelectContent>
              {years.map((itemYear) => (
                <SelectItem key={itemYear} value={String(itemYear)}>
                  {itemYear}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>}

          <Button
            onClick={() => setIsTargetModalOpen(true)}
            className="h-9 rounded-lg border-2 border-slate-300 dark:border-slate-800 bg-card hover:bg-slate-50 dark:hover:bg-slate-800/80 text-xs font-bold text-slate-800 dark:text-slate-200 gap-1.5 px-3"
            variant="outline"
          >
            <Target className="w-4 h-4 text-emerald-500 animate-pulse" />
            Set Targets
          </Button>
        </div>
      </div>

      {/* 1. Universal Reports KPI Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full bg-card/60 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Row 1 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ProgressCard
              title="Revenue"
              statusLabel={revenuePacing.label}
              statusColor={revenuePacing.color}
              value={formatOverviewAmount(revenueValue)}
              maxValue={revenueTarget.toLocaleString()}
              valueSuffix="MMK"
              expectedLabel={`Expected${elapsedDaysText}`}
              expectedValue={Math.round(revenueExpected).toLocaleString()}
              actualPct={revenueActualPct}
              timePct={timePct}
              barColor={revenuePacing.barColor}
              icon={Banknote}
            />
            <ProgressCard
              title="Expense Limit"
              statusLabel={expensePacing.label}
              statusColor={expensePacing.color}
              value={formatOverviewAmount(expenseValue)}
              maxValue={expenseTarget.toLocaleString()}
              valueSuffix="MMK"
              expectedLabel={`Expected${elapsedDaysText}`}
              expectedValue={Math.round(expenseExpected).toLocaleString()}
              actualPct={expenseActualPct}
              timePct={timePct}
              barColor={expensePacing.barColor}
              icon={Wallet}
            />
            <ProgressCard
              title="Profit Margin"
              statusLabel={profitPacing.label}
              statusColor={profitPacing.color}
              value={(revenueValue > 0 ? (profitValue / revenueValue) * 100 : 0).toFixed(1) + "%"}
              maxValue={hasProfitTarget ? "Margin" : undefined}
              expectedLabel="Target Margin"
              expectedValue={hasProfitTarget ? `${targetMarginPct.toFixed(0)}%` : "0%"}
              actualPct={hasProfitTarget && targetMarginPct > 0 ? ((revenueValue > 0 ? (profitValue / revenueValue) * 100 : 0) / targetMarginPct) * 100 : 0}
              timePct={timePct}
              barColor={profitPacing.barColor}
              icon={TrendingUp}
            />
          </div>

          {/* Row 2 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <ProgressCard
              title="Demand (Messages)"
              statusLabel={demandPacing.label}
              statusColor={demandPacing.color}
              value={demandValue.toLocaleString()}
              maxValue={demandTarget.toLocaleString()}
              expectedLabel={`Expected${elapsedDaysText}`}
              expectedValue={Math.round(demandExpected).toLocaleString()}
              actualPct={demandActualPct}
              timePct={timePct}
              barColor={demandPacing.barColor}
              icon={Megaphone}
            />
            <ProgressCard
              title="Appointments"
              statusLabel={apptPacing.label}
              statusColor={apptPacing.color}
              value={apptValue.toLocaleString()}
              maxValue={apptTarget.toLocaleString()}
              expectedLabel={`Expected${elapsedDaysText}`}
              expectedValue={Math.round(apptExpected).toLocaleString()}
              actualPct={apptActualPct}
              timePct={timePct}
              barColor={apptPacing.barColor}
              icon={CalendarCheck}
            />
            <ProgressCard
              title="New Customers"
              statusLabel={customerPacing.label}
              statusColor={customerPacing.color}
              value={customerValue.toLocaleString()}
              maxValue={`${customerTarget} Target`}
              expectedLabel={`Expected${elapsedDaysText}`}
              expectedValue={customerExpected.toLocaleString()}
              actualPct={customerActualPct}
              timePct={timePct}
              barColor={customerPacing.barColor}
              icon={Users}
            />
          </div>
        </div>
      )}

      {/* AI Global Overview Alerts (Relocated under KPI Cards Grid) */}
      {!recsLoading && !isLoading && stats && !(stats.actualDemandCount === 0 && stats.totalAmountSold === 0 && stats.totalCost === 0) && recsData?.recommendations && recsData.recommendations.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
          {recsData.recommendations.slice(0, 4).map((rec, i) => {
             const isAlert = rec.severity === 'urgent' || rec.severity === 'warning';
             const borderColor = isAlert ? 'border-red-300 dark:border-red-900/60' : 'border-emerald-300 dark:border-emerald-900/60';
             const borderLeftColor = isAlert ? 'border-l-red-500' : 'border-l-emerald-500';
             const iconColor = isAlert ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400';
             const Icon = isAlert ? AlertTriangle : Award;

             return (
              <div key={i} className={`bg-card border-2 ${borderColor} border-l-8 ${borderLeftColor} rounded-xl p-5 flex flex-col justify-center shadow-sm`}>
                <div className="flex items-center gap-3 mb-2">
                  <Icon className={`${iconColor} w-5 h-5 flex-shrink-0`} />
                  <h4 className="font-bold text-foreground text-sm">{rec.title}</h4>
                </div>
                <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{rec.insight}</p>
                {rec.action && (
                  <div className="mt-3">
                    <button
                      onClick={() => {
                        if (rec.actionType === 'set_target_modal' || (rec.title.includes("ပစ်မှတ်") && (rec.title.includes("သတ်မှတ်") || rec.title.includes("လိုအပ်")))) {
                          setIsTargetModalOpen(true);
                        } else {
                          router.push(getActionLink(rec));
                        }
                      }}
                      className={`${
                        isAlert
                          ? 'bg-red-600 hover:bg-red-700 text-white'
                          : 'bg-background border-2 border-slate-300 dark:border-slate-700 text-foreground hover:bg-muted'
                      } px-4 py-2 rounded-lg text-xs font-bold transition shadow-sm cursor-pointer`}
                    >
                      {rec.action}
                    </button>
                  </div>
                )}
              </div>
             );
          })}
        </div>
      )}

      {/* 2. Middle Section: Top Services & Live Intelligence */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left: Top Services Table */}
        <div className="bg-card border-2 border-slate-300 dark:border-slate-800 p-6 flex flex-col h-full rounded-xl shadow-sm hover:shadow-lg transition-all duration-200">
            <div className="flex items-center gap-3 mb-4 border-b-2 border-border pb-3">
                <div className="w-8 h-8 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <Trophy className="text-amber-500 w-4 h-4" />
                </div>
                <h3 className="font-bold text-foreground">Top Performing Services</h3>
            </div>
            <div className="overflow-x-auto flex-1">
                <table className="w-full text-left text-sm">
                    <thead>
                        <tr className="text-muted-foreground uppercase text-[10px] font-extrabold tracking-wider border-b-2 border-border">
                            <th className="pb-3 pt-2">Service Package</th>
                            <th className="pb-3 pt-2 text-center">Qty</th>
                            <th className="pb-3 pt-2 text-right">Income (MMK)</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-border/50">
                        {isLoading ? (
                          <tr><td colSpan={3} className="py-4"><Skeleton className="h-10 w-full" /></td></tr>
                        ) : (stats?.topProducts && stats.topProducts.length > 0) ? (
                          stats.topProducts.map((p, i) => (
                            <tr key={i} className="hover:bg-muted/30 transition">
                                <td className="py-3.5 font-bold text-foreground">{p.product}</td>
                                <td className="py-3.5 text-center text-muted-foreground font-bold">{p.totalQty}</td>
                                <td className="py-3.5 text-right font-extrabold text-sky-600 dark:text-sky-400">{p.revenue.toLocaleString()}</td>
                            </tr>
                          ))
                        ) : (
                          <tr><td colSpan={3} className="py-6 text-center text-muted-foreground text-xs font-bold">No service data</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>

        {/* Right: Live Intelligence Feed */}
        <div className="p-6 flex-1 flex flex-col bg-slate-800 dark:bg-slate-900 border-none text-slate-300 shadow-xl relative overflow-hidden rounded-xl">
            <h3 className="text-sm font-bold text-white mb-6 flex items-center gap-3 border-b border-slate-700 pb-4 z-10 relative">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]"></span> Live Intelligence Data
            </h3>
            <div className="space-y-5 text-sm z-10 relative">
                {/* Finance */}
                <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg bg-emerald-900/50 border border-emerald-500/30 text-emerald-400 flex items-center justify-center flex-shrink-0"><DollarSign className="w-4 h-4" /></div>
                    <p className="mt-1"><span className="font-bold text-white">Finance:</span> Highest grossing service <span className="text-sky-300 font-medium">{stats?.topProducts?.[0]?.product || 'N/A'}</span> generated {stats?.topProducts?.[0]?.revenue.toLocaleString() || 0} MMK this period.</p>
                </div>
                {/* Sales */}
                <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg bg-sky-900/50 border border-sky-500/30 text-sky-400 flex items-center justify-center flex-shrink-0"><Phone className="w-4 h-4" /></div>
                    <p className="mt-1"><span className="font-bold text-white">Sales:</span> {stats?.dueTodayRecords && stats.dueTodayRecords.length > 0 ? `Appointment follow-up scheduled for High Potential lead ` : `Sales Funnel active with `} <span className="text-sky-300 font-medium">{stats?.dueTodayRecords && stats.dueTodayRecords.length > 0 ? stats.dueTodayRecords[0].customerName || 'client' : `${stats?.salesFunnel?.appointments || 0} total appointments`}</span> today.</p>
                </div>
                {/* Customers (Replacing Projects) */}
                <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg bg-amber-900/50 border border-amber-500/30 text-amber-400 flex items-center justify-center flex-shrink-0"><Server className="w-4 h-4" /></div>
                    <p className="mt-1"><span className="font-bold text-white">Customers:</span> Total active customer base reached <span className="text-sky-300 font-medium">{stats?.totalCustomers || 0}</span>. {stats?.missingPhoneLeads || 0} leads missing contact info.</p>
                </div>
                {/* System */}
                <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg bg-blue-900/50 border border-blue-500/30 text-blue-400 flex items-center justify-center flex-shrink-0"><Bot className="w-4 h-4" /></div>
                    <p className="mt-1"><span className="font-bold text-white">System:</span> Telegram Bot is <span className="text-sky-300 font-medium">{stats?.botActive ? 'Online' : 'Offline'}</span>. Processed {stats?.todayMessages || 0} messages and {stats?.todayDemandRecords || 0} demands today.</p>
                </div>
            </div>
        </div>
      </div>

      {/* 3. Business Insights Charts */}
      <div className="space-y-6">
        <div className="bg-card border-2 border-slate-300 dark:border-slate-800 p-6 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-6 border-b-2 border-border pb-4">
                <h3 className="font-bold text-foreground text-sm tracking-wide uppercase flex items-center gap-2">
                  <LineChart className="w-4 h-4 text-sky-500" />
                  {period === 'overall' ? 'Yearly Income Trend (MMK)' : period === 'year' ? 'Monthly Income Trend (MMK)' : 'Daily Income Trend (MMK)'}
                </h3>
                <span className="text-xs font-bold text-muted-foreground border-2 border-border bg-muted px-3 py-1 rounded-full">
                  {period === 'overall' ? 'All years' : period === 'month' ? new Date(Number(localYear), Number(localMonth) - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' }) : localYear}
                </span>
            </div>
            {isLoading ? <Skeleton className="h-[280px] w-full bg-card/60 rounded-xl" /> : (
              <PremiumLineChart data={stats?.financialTrend || []} valueKey="revenue" labelKey="label" totalDays={stats?.totalDaysInPeriod || 30} elapsedDays={stats?.elapsedDays} period={period} seriesLabel="Income (MMK)" />
            )}
        </div>
        <div className="bg-card border-2 border-slate-300 dark:border-slate-800 p-6 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-6 border-b-2 border-border pb-4">
                <h3 className="font-bold text-foreground text-sm tracking-wide uppercase flex items-center gap-2">
                  <LineChart className="w-4 h-4 text-red-500" />
                  {period === 'overall' ? 'Yearly Expense Trend (MMK)' : period === 'year' ? 'Monthly Expense Trend (MMK)' : 'Daily Expense Trend (MMK)'}
                </h3>
                <span className="text-xs font-bold text-muted-foreground border-2 border-border bg-muted px-3 py-1 rounded-full">
                  {period === 'overall' ? 'All years' : period === 'month' ? new Date(Number(localYear), Number(localMonth) - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' }) : localYear}
                </span>
            </div>
            {isLoading ? <Skeleton className="h-[280px] w-full bg-card/60 rounded-xl" /> : (
              <PremiumLineChart data={stats?.financialTrend || []} valueKey="expense" labelKey="label" totalDays={stats?.totalDaysInPeriod || 30} elapsedDays={stats?.elapsedDays} period={period} seriesLabel="Expense (MMK)" color="#ef4444" />
            )}
        </div>
        
        <div className="bg-card border-2 border-slate-300 dark:border-slate-800 p-6 rounded-xl shadow-sm">
            <div className="flex justify-between items-center mb-6 border-b-2 border-border pb-4">
                <h3 className="font-bold text-foreground text-sm tracking-wide uppercase flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-sky-500" />
                  {period === 'overall' ? 'Yearly' : period === 'year' ? 'Monthly' : 'Daily'} Demands Received
                </h3>
                <span className="text-xs font-bold text-muted-foreground border-2 border-border bg-muted px-3 py-1 rounded-full">
                  {period === 'overall' ? 'All years' : period === 'month' ? new Date(Number(localYear), Number(localMonth) - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' }) : localYear}
                </span>
            </div>
            {isLoading ? <Skeleton className="h-[280px] w-full bg-card/60 rounded-xl" /> : (
              <PremiumBarChart data={stats?.financialTrend || []} valueKey="demand" labelKey="label" totalDays={stats?.totalDaysInPeriod || 30} elapsedDays={stats?.elapsedDays} period={period} />
            )}
        </div>
      </div>

      {/* ─── Targets Settings Modal ────────────────────────────────────── */}
      {isTargetModalOpen && (
        <ModalPortal className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-card p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div>
                <h3 className="font-extrabold text-foreground flex items-center gap-2">
                  <Target className="w-5 h-5 text-emerald-500" />
                  Set Period Targets
                </h3>
                <p className="text-[11px] text-muted-foreground mt-0.5 font-bold uppercase tracking-wide">
                  For {period === 'year' ? `${year} (Yearly)` : `${new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' })} (Monthly)`}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground" onClick={() => setIsTargetModalOpen(false)}>
                ✕
              </Button>
            </div>

            <div className="space-y-4 text-xs font-semibold text-foreground">
              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                  Target Revenue (Ks)
                </label>
                <Input
                  type="number"
                  placeholder="e.g. 5000000"
                  className="h-10 text-xs bg-muted border-border font-bold"
                  value={targetForm.targetSalesAmount}
                  onChange={(e) => setTargetForm(prev => ({ ...prev, targetSalesAmount: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                  Target Expense (Ks)
                </label>
                <Input
                  type="number"
                  placeholder="e.g. 2500000"
                  className="h-10 text-xs bg-muted border-border font-bold"
                  value={targetForm.targetExpenseAmount}
                  onChange={(e) => setTargetForm(prev => ({ ...prev, targetExpenseAmount: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                  Target Demands (Leads)
                </label>
                <Input
                  type="number"
                  placeholder="e.g. 1000"
                  className="h-10 text-xs bg-muted border-border font-bold"
                  value={targetForm.targetDemandCount}
                  onChange={(e) => setTargetForm(prev => ({ ...prev, targetDemandCount: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                  Target Appointments
                </label>
                <Input
                  type="number"
                  placeholder="e.g. 200"
                  className="h-10 text-xs bg-muted border-border font-bold"
                  value={targetForm.targetAppointments}
                  onChange={(e) => setTargetForm(prev => ({ ...prev, targetAppointments: e.target.value }))}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1.5 uppercase tracking-wide">
                  Target New Customers
                </label>
                <Input
                  type="number"
                  placeholder="e.g. 50"
                  className="h-10 text-xs bg-muted border-border font-bold"
                  value={targetForm.targetNewCustomers}
                  onChange={(e) => setTargetForm(prev => ({ ...prev, targetNewCustomers: e.target.value }))}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-border">
              <Button variant="outline" size="sm" className="border-border text-foreground rounded-lg" onClick={() => setIsTargetModalOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" disabled={isSavingTarget} className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg px-4" onClick={handleSaveTargets}>
                {isSavingTarget && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                Save Targets
              </Button>
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="space-y-6"><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>}>
      <DashboardPageContent />
    </Suspense>
  );
}
