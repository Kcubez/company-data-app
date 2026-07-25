"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ModalPortal } from "@/components/ui/modal-portal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreateFinanceEntry, useDeleteFinanceEntry, useFinanceEntries, useUpdateFinanceEntry } from "@/hooks/use-finance-entries";
import type { FinanceEntry, FinanceEntryStatus, FinanceEntryType } from "@/lib/api";
import { BanknoteArrowDown, CircleDollarSign, ClipboardList, CreditCard, FileText, HandCoins, Landmark, Plus, ReceiptText, Trash2, WalletCards } from "lucide-react";

const TYPES: { value: FinanceEntryType; label: string; detail: string; icon: typeof WalletCards; tone: string }[] = [
  { value: "salary", label: "Salary", detail: "Payroll costs", icon: WalletCards, tone: "border-l-sky-500" },
  { value: "cogs", label: "COGS", detail: "Cost of goods sold", icon: ReceiptText, tone: "border-l-violet-500" },
  { value: "operating_expense", label: "Operating Expenses", detail: "Running costs", icon: BanknoteArrowDown, tone: "border-l-amber-500" },
  { value: "payment", label: "Payments", detail: "Payment records", icon: CreditCard, tone: "border-l-emerald-500" },
  { value: "receivable", label: "Receivables", detail: "Outstanding income", icon: HandCoins, tone: "border-l-cyan-500" },
  { value: "debt", label: "Debt", detail: "Outstanding liabilities", icon: Landmark, tone: "border-l-rose-500" },
  { value: "voucher", label: "Vouchers", detail: "Supporting records", icon: FileText, tone: "border-l-slate-500" },
];

const STATUSES: FinanceEntryStatus[] = ["recorded", "pending", "paid", "settled", "overdue"];
const DEFAULT_FORM = {
  entryDate: format(new Date(), "yyyy-MM-dd"), type: "operating_expense" as FinanceEntryType, title: "", amount: "", status: "recorded" as FinanceEntryStatus,
  counterparty: "", dueDate: "", voucherNumber: "", notes: "",
};

const labelFor = (type: FinanceEntryType) => TYPES.find((item) => item.value === type)?.label ?? type;
const money = (value: number) => `${Math.round(value).toLocaleString()} MMK`;

export function AccountingRecords({ dateFrom, dateTo }: { dateFrom?: string; dateTo?: string }) {
  const [view, setView] = useState<"cards" | "list">("cards");
  const [typeFilter, setTypeFilter] = useState<FinanceEntryType | "all">("all");
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<FinanceEntry | null>(null);
  const [form, setForm] = useState(DEFAULT_FORM);
  const query = useFinanceEntries({ dateFrom, dateTo, type: typeFilter === "all" ? undefined : typeFilter });
  const createEntry = useCreateFinanceEntry();
  const updateEntry = useUpdateFinanceEntry();
  const deleteEntry = useDeleteFinanceEntry();
  const entries = query.data?.entries ?? [];
  const summary = query.data?.summary;
  const totalExpense = (summary?.salary ?? 0) + (summary?.cogs ?? 0) + (summary?.operatingExpense ?? 0);

  const cards = useMemo(() => TYPES.map((item) => {
    const value = item.value === "salary" ? summary?.salary ?? 0
      : item.value === "cogs" ? summary?.cogs ?? 0
      : item.value === "operating_expense" ? summary?.operatingExpense ?? 0
      : item.value === "payment" ? summary?.payments ?? 0
      : item.value === "receivable" ? summary?.receivables ?? 0
      : item.value === "debt" ? summary?.debts ?? 0
      : summary?.vouchers ?? 0;
    return { ...item, entryType: item.value, value, isCount: item.value === "voucher" };
  }), [summary]);

  const openCreate = () => { setEditing(null); setForm(DEFAULT_FORM); setShowForm(true); };
  const openEdit = (entry: FinanceEntry) => {
    setEditing(entry);
    setForm({ entryDate: entry.entryDate.slice(0, 10), type: entry.type, title: entry.title, amount: String(entry.amount), status: entry.status, counterparty: entry.counterparty ?? "", dueDate: entry.dueDate?.slice(0, 10) ?? "", voucherNumber: entry.voucherNumber ?? "", notes: entry.notes ?? "" });
    setShowForm(true);
  };
  const save = async () => {
    const payload = { entryDate: form.entryDate, type: form.type, title: form.title, amount: Number(form.amount), status: form.status, counterparty: form.counterparty || null, dueDate: form.dueDate || null, voucherNumber: form.voucherNumber || null, notes: form.notes || null };
    if (!payload.title || !payload.amount) return;
    if (editing) await updateEntry.mutateAsync({ id: editing.id, data: payload });
    else await createEntry.mutateAsync(payload);
    setShowForm(false);
  };

  return (
    <Card className="overflow-hidden rounded-xl border-2 border-slate-200 shadow-sm dark:border-slate-800">
      <CardHeader className="border-b bg-slate-50/70 dark:bg-slate-950/30">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><ClipboardList className="h-5 w-5 text-sky-600" /> Accounting records</CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">Salary, COGS, operating costs, payments, receivables, debts, and vouchers for the selected period.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border bg-background p-1">
              <Button variant={view === "cards" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setView("cards")}>Card view</Button>
              <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="h-7 text-xs" onClick={() => setView("list")}>List view</Button>
            </div>
            <Button size="sm" onClick={openCreate} className="h-9 bg-sky-600 hover:bg-sky-700"><Plus className="mr-1.5 h-4 w-4" />Add record</Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-5">
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Summary label="Accounting expenses" value={money(totalExpense)} icon={CircleDollarSign} tone="border-l-red-500" />
          <Summary label="Open receivables" value={money(summary?.receivables ?? 0)} icon={HandCoins} tone="border-l-cyan-500" />
          <Summary label="Open debt" value={money(summary?.debts ?? 0)} icon={Landmark} tone="border-l-rose-500" />
          <Summary label="Vouchers" value={`${summary?.vouchers ?? 0} records`} icon={FileText} tone="border-l-slate-500" />
        </div>
        {view === "cards" ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {query.isLoading ? Array.from({ length: 7 }).map((_, index) => <Skeleton key={index} className="h-28 rounded-xl" />) : cards.map(({ value, entryType, isCount, icon: Icon, label, detail, tone }) => (
              <button key={entryType} onClick={() => { setTypeFilter(entryType); setView("list"); }} className={`rounded-xl border border-slate-200 border-l-4 ${tone} bg-card p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md dark:border-slate-800`}>
                <div className="flex items-start justify-between"><div><p className="text-xs font-bold text-slate-600 dark:text-slate-300">{label}</p><p className="mt-2 text-xl font-black text-slate-900 dark:text-white">{isCount ? `${value} records` : money(value)}</p></div><Icon className="h-5 w-5 text-slate-400" /></div>
                <p className="mt-2 text-[11px] text-muted-foreground">{detail}</p>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="mb-4 flex justify-end"><Select value={typeFilter} onValueChange={(value) => { if (value) setTypeFilter(value as FinanceEntryType | "all"); }}><SelectTrigger className="h-9 w-48 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All accounting records</SelectItem>{TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-muted-foreground dark:bg-slate-950/30"><tr>{["Date", "Record", "Type", "Status", "Amount", "Actions"].map((heading) => <th key={heading} className={`px-4 py-3 ${heading === "Amount" ? "text-right" : ""}`}>{heading}</th>)}</tr></thead><tbody className="divide-y">{query.isLoading ? <tr><td colSpan={6} className="p-6"><Skeleton className="h-5 w-full" /></td></tr> : entries.length === 0 ? <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No accounting records for this period.</td></tr> : entries.map((entry) => <tr key={entry.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-950/30"><td className="whitespace-nowrap px-4 py-3 text-xs">{format(new Date(entry.entryDate), "yyyy-MM-dd")}</td><td className="px-4 py-3"><p className="font-semibold">{entry.title}</p><p className="text-xs text-muted-foreground">{entry.counterparty ?? entry.voucherNumber ?? "—"}</p></td><td className="px-4 py-3"><Badge variant="outline">{labelFor(entry.type)}</Badge></td><td className="px-4 py-3"><Badge className={entry.status === "overdue" ? "bg-rose-100 text-rose-700 hover:bg-rose-100" : "bg-slate-100 text-slate-700 hover:bg-slate-100"}>{entry.status}</Badge></td><td className="whitespace-nowrap px-4 py-3 text-right font-bold">{money(entry.amount)}</td><td className="px-4 py-3"><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => openEdit(entry)}>Edit</Button><Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => deleteEntry.mutate(entry.id)} aria-label="Delete finance record"><Trash2 className="h-4 w-4" /></Button></div></td></tr>)}</tbody></table></div>
          </>
        )}
      </CardContent>
      {showForm && <FinanceEntryForm form={form} setForm={setForm} title={editing ? "Edit accounting record" : "Add accounting record"} pending={createEntry.isPending || updateEntry.isPending} onClose={() => setShowForm(false)} onSave={save} />}
    </Card>
  );
}

function Summary({ label, value, icon: Icon, tone }: { label: string; value: string; icon: typeof CircleDollarSign; tone: string }) { return <div className={`rounded-xl border border-slate-200 border-l-4 ${tone} bg-card p-4 dark:border-slate-800`}><div className="flex justify-between"><div><p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p><p className="mt-1 text-lg font-black">{value}</p></div><Icon className="h-5 w-5 text-slate-400" /></div></div>; }

function FinanceEntryForm({ form, setForm, title, pending, onClose, onSave }: { form: typeof DEFAULT_FORM; setForm: React.Dispatch<React.SetStateAction<typeof DEFAULT_FORM>>; title: string; pending: boolean; onClose: () => void; onSave: () => void }) {
  const input = (key: keyof typeof DEFAULT_FORM, value: string) => setForm((current) => ({ ...current, [key]: value }));
  return <ModalPortal className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-xl bg-card p-6 shadow-xl"><div className="mb-5 flex items-center justify-between"><h3 className="font-bold">{title}</h3><Button variant="ghost" size="icon" onClick={onClose}>×</Button></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><Field label="Date"><Input type="date" value={form.entryDate} onChange={(event) => input("entryDate", event.target.value)} /></Field><Field label="Type"><Select value={form.type} onValueChange={(value) => { if (value) input("type", value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field><Field label="Title" wide><Input value={form.title} onChange={(event) => input("title", event.target.value)} placeholder="e.g. July staff payroll" /></Field><Field label="Amount (MMK)"><Input type="number" min="1" value={form.amount} onChange={(event) => input("amount", event.target.value)} /></Field><Field label="Status"><Select value={form.status} onValueChange={(value) => { if (value) input("status", value); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></Field><Field label="Customer / supplier"><Input value={form.counterparty} onChange={(event) => input("counterparty", event.target.value)} /></Field><Field label="Due date"><Input type="date" value={form.dueDate} onChange={(event) => input("dueDate", event.target.value)} /></Field><Field label="Voucher no." wide><Input value={form.voucherNumber} onChange={(event) => input("voucherNumber", event.target.value)} /></Field><Field label="Notes" wide><Input value={form.notes} onChange={(event) => input("notes", event.target.value)} /></Field></div><div className="mt-6 flex justify-end gap-2"><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={pending || !form.title || !form.amount} onClick={onSave}>{pending ? "Saving…" : "Save record"}</Button></div></div></ModalPortal>;
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) { return <label className={wide ? "sm:col-span-2" : ""}><span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>{children}</label>; }
