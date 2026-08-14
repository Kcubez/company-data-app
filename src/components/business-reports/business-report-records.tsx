"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DestructiveConfirmDialog } from "@/components/ui/destructive-confirm-dialog";
import { Input } from "@/components/ui/input";
import { ModalPortal } from "@/components/ui/modal-portal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useBusinessReports,
  useDeleteBusinessReport,
  useUpdateBusinessReport,
} from "@/hooks/use-business-reports";
import type { BusinessReport } from "@/lib/api";
import { ClipboardList, Pencil, Trash2, X } from "lucide-react";

const CHANNELS = ["Facebook", "Google", "Referral", "Walk-in", "Telegram", "Other"] as const;
const PAGE_SIZE = 10;

const DEFAULT_FORM = {
  reportDate: format(new Date(), "yyyy-MM-dd"),
  reporterName: "",
  marketingChannel: "",
  marketingBudget: "",
  callsMade: "",
  appointmentsMade: "",
  appointmentsKept: "",
  newLeads: "",
  totalDemandCount: "",
  totalSalesAmount: "",
  closedDeals: "",
  pendingDeals: "",
  targetSalesAmount: "",
  targetDemandCount: "",
  targetAppointments: "",
  notes: "",
};

function fmtNum(value: number | null | undefined) {
  if (value == null) return "—";
  return value.toLocaleString();
}

function toForm(record: BusinessReport) {
  return {
    reportDate: record.reportDate.slice(0, 10),
    reporterName: record.reporterName ?? "",
    marketingChannel: record.marketingChannel ?? "",
    marketingBudget: record.marketingBudget != null ? String(record.marketingBudget) : "",
    callsMade: record.callsMade != null ? String(record.callsMade) : "",
    appointmentsMade: record.appointmentsMade != null ? String(record.appointmentsMade) : "",
    appointmentsKept: record.appointmentsKept != null ? String(record.appointmentsKept) : "",
    newLeads: record.newLeads != null ? String(record.newLeads) : "",
    totalDemandCount: record.totalDemandCount != null ? String(record.totalDemandCount) : "",
    totalSalesAmount: record.totalSalesAmount != null ? String(record.totalSalesAmount) : "",
    closedDeals: record.closedDeals != null ? String(record.closedDeals) : "",
    pendingDeals: record.pendingDeals != null ? String(record.pendingDeals) : "",
    targetSalesAmount: record.targetSalesAmount != null ? String(record.targetSalesAmount) : "",
    targetDemandCount: record.targetDemandCount != null ? String(record.targetDemandCount) : "",
    targetAppointments: record.targetAppointments != null ? String(record.targetAppointments) : "",
    notes: record.notes ?? "",
  };
}

function parseOptionalNumber(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function parseOptionalInt(value: string) {
  const num = parseOptionalNumber(value);
  return num == null ? null : Math.round(num);
}

export function BusinessReportRecords({ dateFrom, dateTo }: { dateFrom?: string; dateTo?: string }) {
  const [page, setPage] = useState(1);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [editing, setEditing] = useState<BusinessReport | null>(null);
  const [deleting, setDeleting] = useState<BusinessReport | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);

  const query = useBusinessReports({
    page,
    limit: PAGE_SIZE,
    dateFrom,
    dateTo,
    channel: channelFilter === "all" ? undefined : channelFilter,
  });
  const updateMutation = useUpdateBusinessReport();
  const deleteMutation = useDeleteBusinessReport();

  const records = query.data?.records ?? [];
  const totalPages = Math.max(1, Math.ceil((query.data?.total ?? 0) / PAGE_SIZE));

  const channelOptions = useMemo(() => {
    const fromData = records
      .map((record) => record.marketingChannel)
      .filter((channel): channel is string => Boolean(channel?.trim()));
    return Array.from(new Set([...CHANNELS, ...fromData]));
  }, [records]);

  const openEdit = (record: BusinessReport) => {
    setEditing(record);
    setForm(toForm(record));
  };

  const save = async () => {
    if (!editing) return;
    await updateMutation.mutateAsync({
      id: editing.id,
      data: {
        reportDate: form.reportDate,
        reporterName: form.reporterName.trim() || null,
        marketingChannel: form.marketingChannel.trim() || null,
        marketingBudget: parseOptionalNumber(form.marketingBudget),
        callsMade: parseOptionalInt(form.callsMade),
        appointmentsMade: parseOptionalInt(form.appointmentsMade),
        appointmentsKept: parseOptionalInt(form.appointmentsKept),
        newLeads: parseOptionalInt(form.newLeads),
        totalDemandCount: parseOptionalInt(form.totalDemandCount),
        totalSalesAmount: parseOptionalNumber(form.totalSalesAmount),
        closedDeals: parseOptionalInt(form.closedDeals),
        pendingDeals: parseOptionalInt(form.pendingDeals),
        targetSalesAmount: parseOptionalNumber(form.targetSalesAmount),
        targetDemandCount: parseOptionalInt(form.targetDemandCount),
        targetAppointments: parseOptionalInt(form.targetAppointments),
        notes: form.notes.trim() || null,
      },
    });
    setEditing(null);
  };

  return (
    <Card id="business-reports-table" className="overflow-hidden rounded-xl border-2 border-slate-200 shadow-sm dark:border-slate-800">
      <CardHeader className="border-b bg-slate-50/70 p-5 dark:bg-slate-950/30">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-slate-100">
              <ClipboardList className="h-5 w-5 text-sky-600" />
              Business Reports
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Daily and monthly marketing reports from Telegram — edit misparsed rows here without changing the bot message.
            </p>
          </div>
          <Select value={channelFilter} onValueChange={(value) => { if (value) { setChannelFilter(value); setPage(1); } }}>
            <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm font-semibold sm:w-52 dark:border-slate-800 dark:bg-slate-950">
              <SelectValue placeholder="All channels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All channels</SelectItem>
              {channelOptions.map((channel) => (
                <SelectItem key={channel} value={channel}>{channel}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-5">
        <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-slate-950/30">
                <tr>
                  {["Date", "Reporter", "Channel", "Budget", "Calls", "Appts", "Leads", "Demand", "Sales", "Closed", "Pending", "Notes", "Actions"].map((heading) => (
                    <th key={heading} className={`px-4 py-3 ${heading === "Actions" ? "text-right" : ""}`}>
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {query.isLoading ? (
                  Array.from({ length: 5 }).map((_, rowIndex) => (
                    <tr key={rowIndex}>
                      {Array.from({ length: 13 }).map((__, cellIndex) => (
                        <td key={cellIndex} className="px-4 py-4"><Skeleton className="h-4 w-20" /></td>
                      ))}
                    </tr>
                  ))
                ) : records.length === 0 ? (
                  <tr><td colSpan={13} className="p-8 text-center text-muted-foreground">No business reports for this period.</td></tr>
                ) : records.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/30">
                    <td className="whitespace-nowrap px-4 py-4 text-xs font-semibold text-muted-foreground">
                      {format(new Date(record.reportDate), "yyyy-MM-dd")}
                    </td>
                    <td className="px-4 py-4 font-semibold text-slate-800 dark:text-slate-100">
                      {record.reporterName || record.sender?.displayName || "—"}
                    </td>
                    <td className="px-4 py-4">
                      {record.marketingChannel ? (
                        <Badge variant="outline" className="font-semibold">{record.marketingChannel}</Badge>
                      ) : "—"}
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 font-semibold">{fmtNum(record.marketingBudget)}</td>
                    <td className="px-4 py-4">{fmtNum(record.callsMade)}</td>
                    <td className="px-4 py-4 text-xs">
                      <span>{fmtNum(record.appointmentsMade)}</span>
                      <span className="text-muted-foreground"> / {fmtNum(record.appointmentsKept)}</span>
                    </td>
                    <td className="px-4 py-4">{fmtNum(record.newLeads)}</td>
                    <td className="px-4 py-4">{fmtNum(record.totalDemandCount)}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-bold text-slate-900 dark:text-slate-100">{fmtNum(record.totalSalesAmount)}</td>
                    <td className="px-4 py-4">{fmtNum(record.closedDeals)}</td>
                    <td className="px-4 py-4">{fmtNum(record.pendingDeals)}</td>
                    <td className="max-w-[180px] px-4 py-4 text-xs text-muted-foreground">
                      <span className="line-clamp-2" title={record.notes ?? undefined}>{record.notes || "—"}</span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(record)} aria-label="Edit business report">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => setDeleting(record)} aria-label="Delete business report">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/30">
            <span className="text-xs font-bold text-slate-500">Page {page} of {totalPages}</span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-8 text-xs font-bold" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                Prev
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs font-bold" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>

      {editing && (
        <BusinessReportForm
          form={form}
          setForm={setForm}
          channelOptions={channelOptions}
          pending={updateMutation.isPending}
          onClose={() => setEditing(null)}
          onSave={save}
        />
      )}

      {deleting && (
        <DestructiveConfirmDialog
          title="Delete business report?"
          description={
            <>
              This moves the report from{" "}
              <span className="font-semibold text-red-700 dark:text-red-300">
                {format(new Date(deleting.reportDate), "yyyy-MM-dd")}
              </span>
              {" "}to Trash.
            </>
          }
          confirmLabel="Delete report"
          notice="This record can be restored from Trash"
          isPending={deleteMutation.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteMutation.mutateAsync(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Card>
  );
}

function BusinessReportForm({
  form,
  setForm,
  channelOptions,
  pending,
  onClose,
  onSave,
}: {
  form: typeof DEFAULT_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof DEFAULT_FORM>>;
  channelOptions: string[];
  pending: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const input = (key: keyof typeof DEFAULT_FORM, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <ModalPortal className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-black">Edit business report</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close business report form">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Report date"><Input type="date" value={form.reportDate} onChange={(event) => input("reportDate", event.target.value)} /></Field>
          <Field label="Reporter name"><Input value={form.reporterName} onChange={(event) => input("reporterName", event.target.value)} /></Field>
          <Field label="Marketing channel">
            <Select value={form.marketingChannel || "__none__"} onValueChange={(value) => input("marketingChannel", value === "__none__" ? "" : value ?? "")}>
              <SelectTrigger><SelectValue placeholder="Select channel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">—</SelectItem>
                {channelOptions.map((channel) => <SelectItem key={channel} value={channel}>{channel}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Marketing budget (MMK)"><Input type="number" min="0" value={form.marketingBudget} onChange={(event) => input("marketingBudget", event.target.value)} /></Field>
          <Field label="Calls made"><Input type="number" min="0" value={form.callsMade} onChange={(event) => input("callsMade", event.target.value)} /></Field>
          <Field label="Appointments made"><Input type="number" min="0" value={form.appointmentsMade} onChange={(event) => input("appointmentsMade", event.target.value)} /></Field>
          <Field label="Appointments kept"><Input type="number" min="0" value={form.appointmentsKept} onChange={(event) => input("appointmentsKept", event.target.value)} /></Field>
          <Field label="New leads"><Input type="number" min="0" value={form.newLeads} onChange={(event) => input("newLeads", event.target.value)} /></Field>
          <Field label="Total demand count"><Input type="number" min="0" value={form.totalDemandCount} onChange={(event) => input("totalDemandCount", event.target.value)} /></Field>
          <Field label="Total sales (MMK)"><Input type="number" min="0" value={form.totalSalesAmount} onChange={(event) => input("totalSalesAmount", event.target.value)} /></Field>
          <Field label="Closed deals"><Input type="number" min="0" value={form.closedDeals} onChange={(event) => input("closedDeals", event.target.value)} /></Field>
          <Field label="Pending deals"><Input type="number" min="0" value={form.pendingDeals} onChange={(event) => input("pendingDeals", event.target.value)} /></Field>
          <Field label="Target sales (MMK)"><Input type="number" min="0" value={form.targetSalesAmount} onChange={(event) => input("targetSalesAmount", event.target.value)} /></Field>
          <Field label="Target demand count"><Input type="number" min="0" value={form.targetDemandCount} onChange={(event) => input("targetDemandCount", event.target.value)} /></Field>
          <Field label="Target appointments"><Input type="number" min="0" value={form.targetAppointments} onChange={(event) => input("targetAppointments", event.target.value)} /></Field>
          <Field label="Notes" wide>
            <textarea
              value={form.notes}
              onChange={(event) => input("notes", event.target.value)}
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              placeholder="Remarks or context from the original report"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || !form.reportDate} onClick={onSave}>{pending ? "Saving..." : "Save report"}</Button>
        </div>
      </div>
    </ModalPortal>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label className={wide ? "sm:col-span-2" : ""}>
      <span className="mb-1 block text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
