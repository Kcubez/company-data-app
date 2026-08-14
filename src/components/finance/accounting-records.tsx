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
import { useCreateFinanceEntry, useDeleteFinanceEntry, useFinanceEntries, useUpdateFinanceEntry } from "@/hooks/use-finance-entries";
import type { FinanceEntry, FinanceEntryStatus, FinanceEntryType } from "@/lib/api";
import {
  BanknoteArrowDown,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  FileText,
  HandCoins,
  Landmark,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  WalletCards,
  X,
} from "lucide-react";

const TYPES: {
  value: FinanceEntryType;
  label: string;
  detail: string;
  icon: typeof WalletCards;
  tone: string;
  iconTone: string;
}[] = [
  { value: "salary", label: "Salary", detail: "Payroll costs", icon: WalletCards, tone: "border-l-sky-500", iconTone: "text-sky-600 bg-sky-50" },
  { value: "cogs", label: "COGS", detail: "Cost of goods sold", icon: ReceiptText, tone: "border-l-violet-500", iconTone: "text-violet-600 bg-violet-50" },
  { value: "operating_expense", label: "Operating Expenses", detail: "Running costs", icon: BanknoteArrowDown, tone: "border-l-amber-500", iconTone: "text-amber-600 bg-amber-50" },
  { value: "payment", label: "Payments", detail: "Payment records", icon: CreditCard, tone: "border-l-emerald-500", iconTone: "text-emerald-600 bg-emerald-50" },
  { value: "receivable", label: "Receivables", detail: "Outstanding income", icon: HandCoins, tone: "border-l-cyan-500", iconTone: "text-cyan-600 bg-cyan-50" },
  { value: "debt", label: "Debt", detail: "Outstanding liabilities", icon: Landmark, tone: "border-l-rose-500", iconTone: "text-rose-600 bg-rose-50" },
  { value: "voucher", label: "Vouchers", detail: "Supporting records", icon: FileText, tone: "border-l-slate-500", iconTone: "text-slate-600 bg-slate-50" },
  { value: "owner_capital", label: "Owner Capital", detail: "Business investment", icon: Landmark, tone: "border-l-indigo-500", iconTone: "text-indigo-600 bg-indigo-50" },
];

const STATUSES: FinanceEntryStatus[] = ["recorded", "pending", "paid", "settled", "overdue"];
const PAGE_SIZE = 10;

const DEFAULT_FORM = {
  entryDate: format(new Date(), "yyyy-MM-dd"),
  type: "operating_expense" as FinanceEntryType,
  title: "",
  amount: "",
  status: "recorded" as FinanceEntryStatus,
  counterparty: "",
  dueDate: "",
  voucherNumber: "",
  notes: "",
};

const labelFor = (type: FinanceEntryType) => TYPES.find((item) => item.value === type)?.label ?? type;
const moneyNumber = (value: number) => Math.round(value).toLocaleString();

function statusClass(status: FinanceEntryStatus) {
  if (status === "overdue") return "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-50";
  if (status === "pending") return "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50";
  if (status === "paid" || status === "settled") return "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50";
  return "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100";
}

function cashTypeFor(type: FinanceEntryType) {
  if (type === "owner_capital") return "Capital";
  return type === "payment" || type === "receivable" || type === "voucher" ? "Income" : "Expense";
}

export function AccountingRecords({ dateFrom, dateTo }: { dateFrom?: string; dateTo?: string }) {
  const [typeFilter, setTypeFilter] = useState<FinanceEntryType | "all">("all");
  const [statusFilter, setStatusFilter] = useState<FinanceEntryStatus | "all">("all");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [deleting, setDeleting] = useState<FinanceEntry | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);

  const query = useFinanceEntries({
    dateFrom,
    dateTo,
    type: typeFilter === "all" ? undefined : typeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const createEntry = useCreateFinanceEntry();
  const updateEntry = useUpdateFinanceEntry();
  const deleteEntry = useDeleteFinanceEntry();
  const entries = query.data?.entries ?? [];
  const summary = query.data?.summary;
  const totalExpense = (summary?.salary ?? 0) + (summary?.cogs ?? 0) + (summary?.operatingExpense ?? 0);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const visibleEntries = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const cards = useMemo(() => TYPES.map((item) => {
    const value = item.value === "salary" ? summary?.salary ?? 0
      : item.value === "cogs" ? summary?.cogs ?? 0
      : item.value === "operating_expense" ? summary?.operatingExpense ?? 0
      : item.value === "payment" ? summary?.payments ?? 0
      : item.value === "receivable" ? summary?.receivables ?? 0
      : item.value === "debt" ? summary?.debts ?? 0
      : item.value === "voucher" ? summary?.vouchers ?? 0
      : summary?.ownerCapital ?? 0;

    return { ...item, entryType: item.value, value, isCount: item.value === "voucher" };
  }), [summary]);

  const updateTypeFilter = (value: FinanceEntryType | "all") => {
    setTypeFilter(value);
    setPage(1);
  };

  const updateStatusFilter = (value: FinanceEntryStatus | "all") => {
    setStatusFilter(value);
    setPage(1);
  };

  const openCreate = () => {
    setEditing(null);
    setForm(DEFAULT_FORM);
    setShowForm(true);
  };

  const openEdit = (entry: FinanceEntry) => {
    setEditing(entry);
    setForm({
      entryDate: entry.entryDate.slice(0, 10),
      type: entry.type,
      title: entry.title,
      amount: String(entry.amount),
      status: entry.status,
      counterparty: entry.counterparty ?? "",
      dueDate: entry.dueDate?.slice(0, 10) ?? "",
      voucherNumber: entry.voucherNumber ?? "",
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  };

  const save = async () => {
    const payload = {
      entryDate: form.entryDate,
      type: form.type,
      title: form.title.trim(),
      amount: Number(form.amount),
      status: form.status,
      counterparty: form.counterparty || null,
      dueDate: form.dueDate || null,
      voucherNumber: form.voucherNumber || null,
      notes: form.notes || null,
    };

    if (!payload.title || !payload.amount) return;
    if (editing) await updateEntry.mutateAsync({ id: editing.id, data: payload });
    else await createEntry.mutateAsync(payload);
    setShowForm(false);
  };

  return (
    <Card id="finance-records-table" className="overflow-hidden rounded-xl border-2 border-slate-200 shadow-sm dark:border-slate-800">
      <CardHeader className="border-b bg-slate-50/70 p-5 dark:bg-slate-950/30">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg font-black text-slate-900 dark:text-slate-100">
              <ClipboardList className="h-5 w-5 text-sky-600" />
              Finance Records
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Income, expenses, accounting category, status, counterparty, due date, voucher, and payment context in one table.
            </p>
          </div>
          <Button size="sm" onClick={openCreate} className="h-10 w-fit bg-sky-600 px-4 hover:bg-sky-700">
            <Plus className="mr-1.5 h-4 w-4" />
            Add record
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
          <Summary label="Accounting Expenses" value={<AmountValue value={totalExpense} />} icon={CircleDollarSign} tone="border-l-red-500" />
          <Summary label="Open Receivables" value={<AmountValue value={summary?.receivables ?? 0} />} icon={HandCoins} tone="border-l-cyan-500" />
          <Summary label="Open Debt" value={<AmountValue value={summary?.debts ?? 0} />} icon={Landmark} tone="border-l-rose-500" />
          <Summary label="Vouchers" value={<CountValue value={summary?.vouchers ?? 0} />} icon={FileText} tone="border-l-slate-500" />
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {query.isLoading
            ? Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)
            : cards.map(({ value, entryType, isCount, icon: Icon, label, detail, tone, iconTone }) => (
              <button
                key={entryType}
                onClick={() => updateTypeFilter(entryType)}
                className={`group rounded-xl border border-slate-200 border-l-4 ${tone} bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800 ${
                  typeFilter === entryType ? "ring-2 ring-sky-400" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">{label}</p>
                    <div className="mt-2 truncate">
                      {isCount ? <CountValue value={value} /> : <AmountValue value={value} />}
                    </div>
                  </div>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
                    <Icon className="h-4 w-4" />
                  </span>
                </div>
                <p className="mt-3 text-xs font-medium text-muted-foreground">{detail}</p>
              </button>
            ))}
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-sm font-semibold text-muted-foreground">
              Showing <span className="text-slate-900 dark:text-slate-100">{visibleEntries.length}</span> of <span className="text-slate-900 dark:text-slate-100">{entries.length}</span> records
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={typeFilter} onValueChange={(value) => updateTypeFilter(value as FinanceEntryType | "all")}>
                <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm font-semibold sm:w-56 dark:border-slate-800 dark:bg-slate-950">
                  <SelectValue placeholder="All accounting types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounting types</SelectItem>
                  {TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(value) => updateStatusFilter(value as FinanceEntryStatus | "all")}>
                <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white text-sm font-semibold sm:w-44 dark:border-slate-800 dark:bg-slate-950">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  {STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1280px] text-left text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-muted-foreground dark:bg-slate-950/30">
                  <tr>
                    {["Date", "Description", "Type", "Amount", "Accounting Type", "Status", "Counterparty", "Due Date", "Voucher / Ref", "Payment / Notes", "Actions"].map((heading) => (
                      <th key={heading} className={`px-4 py-3 ${heading === "Amount" || heading === "Actions" ? "text-right" : ""}`}>
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {query.isLoading ? (
                    Array.from({ length: 5 }).map((_, rowIndex) => (
                      <tr key={rowIndex}>
                        {Array.from({ length: 11 }).map((__, cellIndex) => (
                          <td key={cellIndex} className="px-4 py-4"><Skeleton className="h-4 w-24" /></td>
                        ))}
                      </tr>
                    ))
                  ) : entries.length === 0 ? (
                    <tr><td colSpan={11} className="p-8 text-center text-muted-foreground">No finance records for this period.</td></tr>
                  ) : visibleEntries.map((entry) => {
                    const cashType = cashTypeFor(entry.type);
                    return (
                      <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/30">
                        <td className="whitespace-nowrap px-4 py-4 text-xs font-semibold text-muted-foreground">{format(new Date(entry.entryDate), "yyyy-MM-dd")}</td>
                        <td className="min-w-[220px] px-4 py-4">
                          <p className="font-bold text-slate-900 dark:text-slate-100">{entry.title}</p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{entry.notes ?? "-"}</p>
                        </td>
                        <td className="px-4 py-4">
                          <Badge variant="outline" className={cashType === "Income" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : cashType === "Capital" ? "border-indigo-200 bg-indigo-50 text-indigo-700" : "border-red-200 bg-red-50 text-red-700"}>
                            {cashType}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-right"><AmountValue value={entry.amount} size="sm" /></td>
                        <td className="px-4 py-4"><Badge variant="outline" className="font-semibold">{labelFor(entry.type)}</Badge></td>
                        <td className="px-4 py-4"><Badge variant="outline" className={statusClass(entry.status)}>{entry.status}</Badge></td>
                        <td className="min-w-[160px] px-4 py-4 font-semibold text-slate-700 dark:text-slate-200">{entry.counterparty ?? "-"}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-xs font-semibold text-muted-foreground">{entry.dueDate ? format(new Date(entry.dueDate), "yyyy-MM-dd") : "-"}</td>
                        <td className="whitespace-nowrap px-4 py-4 text-xs font-semibold text-muted-foreground">{entry.voucherNumber ?? "-"}</td>
                        <td className="min-w-[180px] px-4 py-4 text-xs text-muted-foreground">{entry.notes ?? "-"}</td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-1">
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-foreground" onClick={() => openEdit(entry)} aria-label="Edit finance record">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => setDeleting(entry)} aria-label="Delete finance record">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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
        </div>
      </CardContent>

      {showForm && (
        <FinanceEntryForm
          form={form}
          setForm={setForm}
          title={editing ? "Edit finance record" : "Add finance record"}
          pending={createEntry.isPending || updateEntry.isPending}
          onClose={() => setShowForm(false)}
          onSave={save}
        />
      )}

      {deleting && (
        <DestructiveConfirmDialog
          title="Delete finance record?"
          description={
            <>
              This moves <span className="font-semibold text-red-700 dark:text-red-300">{deleting.title}</span> to Trash.
            </>
          }
          confirmLabel="Delete record"
          notice="This record can be restored from Trash"
          isPending={deleteEntry.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => {
            await deleteEntry.mutateAsync(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Card>
  );
}

function AmountValue({ value, size = "md" }: { value: number; size?: "md" | "sm" }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className={size === "sm" ? "text-base font-black text-slate-900 dark:text-slate-100" : "text-lg font-black sm:text-xl text-slate-900 dark:text-slate-100"}>
        {moneyNumber(value)}
      </span>
      <span className="text-[11px] font-bold text-slate-400 shrink-0">MMK</span>
    </span>
  );
}

function CountValue({ value }: { value: number }) {
  return (
    <span className="inline-flex items-baseline gap-1 whitespace-nowrap">
      <span className="text-lg font-black sm:text-xl text-slate-900 dark:text-slate-100">{Math.round(value).toLocaleString()}</span>
      <span className="text-[11px] font-bold text-slate-400 shrink-0">records</span>
    </span>
  );
}

function Summary({ label, value, icon: Icon, tone }: { label: string; value: React.ReactNode; icon: typeof CircleDollarSign; tone: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${tone} bg-card p-4 shadow-sm dark:border-slate-800`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-wide text-muted-foreground">{label}</p>
          <div className="mt-2 overflow-x-auto no-scrollbar">{value}</div>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-900">
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

function FinanceEntryForm({
  form,
  setForm,
  title,
  pending,
  onClose,
  onSave,
}: {
  form: typeof DEFAULT_FORM;
  setForm: React.Dispatch<React.SetStateAction<typeof DEFAULT_FORM>>;
  title: string;
  pending: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  const input = (key: keyof typeof DEFAULT_FORM, value: string) => setForm((current) => ({ ...current, [key]: value }));

  return (
    <ModalPortal className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-card p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-black">{title}</h3>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close finance entry form">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Date"><Input type="date" value={form.entryDate} onChange={(event) => input("entryDate", event.target.value)} /></Field>
          <Field label="Type">
            <Select value={form.type} onValueChange={(value) => { if (value) input("type", value); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Title" wide><Input value={form.title} onChange={(event) => input("title", event.target.value)} placeholder="e.g. July staff payroll" /></Field>
          <Field label="Amount (MMK)"><Input type="number" min="1" value={form.amount} onChange={(event) => input("amount", event.target.value)} /></Field>
          <Field label="Status">
            <Select value={form.status} onValueChange={(value) => { if (value) input("status", value); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="Customer / supplier"><Input value={form.counterparty} onChange={(event) => input("counterparty", event.target.value)} /></Field>
          <Field label="Due date"><Input type="date" value={form.dueDate} onChange={(event) => input("dueDate", event.target.value)} /></Field>
          <Field label="Voucher no." wide><Input value={form.voucherNumber} onChange={(event) => input("voucherNumber", event.target.value)} /></Field>
          <Field label="Notes" wide><Input value={form.notes} onChange={(event) => input("notes", event.target.value)} /></Field>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={pending || !form.title || !form.amount} onClick={onSave}>{pending ? "Saving..." : "Save record"}</Button>
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
