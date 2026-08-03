'use client';

import { useDataApprovals } from '@/hooks/use-data-approvals';
import { DataApproval } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ClipboardCheck, Clock3, CheckCircle2, CircleX, FileText, UserRound } from 'lucide-react';

const statusConfig: Record<string, { label: string; className: string }> = {
  pending_owner_review: { label: 'Awaiting review', className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300' },
  awaiting_rejection_reason: { label: 'Reason required', className: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300' },
  approved: { label: 'Approved', className: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300' },
  confirmed: { label: 'Imported directly', className: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-300' },
  rejected: { label: 'Rejected', className: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300' },
  pending: { label: 'Staff preview', className: 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300' },
  cancelled: { label: 'Cancelled', className: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300' },
  expired: { label: 'Expired', className: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300' },
};

function personName(person: DataApproval['sender'] | null) {
  if (!person) return '—';
  return person.displayName || `${person.firstName || ''} ${person.lastName || ''}`.trim() || person.email || 'Staff member';
}

function reportLabel(reportType: string) {
  if (reportType === 'customer_service') return 'Customer Service';
  if (reportType === 'finance_transactions') return 'Finance Transactions';
  if (reportType === 'project_service_tracking') return 'Project & Service Tracking';
  if (reportType === 'business_report') return 'Business KPI Report';
  return 'Sales & Marketing';
}

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}

export default function DataApprovalsPage() {
  const { data, isLoading, error } = useDataApprovals();
  const approvals = data?.approvals ?? [];
  const summary = data?.summary ?? { awaitingReview: 0, approved: 0, rejected: 0 };

  const statCards = [
    { label: 'Awaiting Review', value: summary.awaitingReview, icon: Clock3, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-300' },
    { label: 'Approved', value: summary.approved, icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300' },
    { label: 'Rejected', value: summary.rejected, icon: CircleX, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300' },
  ];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold text-foreground">Data Approvals</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Review the status and audit trail of staff file submissions. Approval actions are completed securely in Telegram by assigned Data Approvers.</p>
        </div>
        <Badge variant="outline" className="w-fit border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/30 dark:text-violet-300">
          Telegram approval workflow
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {statCards.map(({ label, value, icon: Icon, tone }) => (
          <Card key={label} className="border-border/70 shadow-sm">
            <CardContent className="flex items-center gap-4 p-5">
              <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
              <div><p className="text-sm font-medium text-muted-foreground">{label}</p><p className="mt-0.5 text-2xl font-bold tabular-nums">{value}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden border-border/70 shadow-sm">
        <CardHeader className="border-b border-border/60 bg-muted/20 px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4 text-blue-600" aria-hidden="true" />Submission history</CardTitle>
          <CardDescription>Most recent 100 Telegram file submissions across your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? <div className="p-10 text-center text-sm text-muted-foreground">Loading approval history…</div> : error ? <div className="p-10 text-center text-sm text-rose-600">Unable to load approval history.</div> : approvals.length === 0 ? (
            <div className="p-12 text-center"><FileText className="mx-auto mb-3 h-9 w-9 text-muted-foreground/40" aria-hidden="true" /><p className="font-medium">No file submissions yet</p><p className="mt-1 text-sm text-muted-foreground">Staff file previews will appear here after they are sent through Telegram.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[900px] w-full text-left text-sm">
                <thead className="bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground"><tr><th className="px-5 py-3">Submission</th><th className="px-4 py-3">Submitted by</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Review</th><th className="px-5 py-3">Submitted</th></tr></thead>
                <tbody className="divide-y divide-border/60">
                  {approvals.map((approval) => {
                    const status = statusConfig[approval.status] ?? { label: approval.status, className: 'border-slate-200 bg-slate-50 text-slate-700' };
                    return <tr key={approval.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300"><FileText className="h-4 w-4" aria-hidden="true" /></span><div><p className="max-w-[240px] truncate font-semibold text-foreground">{approval.fileName}</p></div></div></td>
                      <td className="px-4 py-4"><div className="flex items-center gap-2"><UserRound className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /><span className="font-medium">{personName(approval.sender)}</span></div></td>
                      <td className="px-4 py-4"><Badge variant="outline" className="text-xs font-medium">{reportLabel(approval.reportType)}</Badge></td>
                      <td className="px-4 py-4"><Badge variant="outline" className={`whitespace-nowrap text-xs font-semibold ${status.className}`}>{status.label}</Badge></td>
                      <td className="max-w-[300px] px-4 py-4"><p className="font-medium text-foreground">{personName(approval.approver)}</p>{approval.reviewNote && <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{approval.reviewNote}</p>}</td>
                      <td className="whitespace-nowrap px-5 py-4 text-xs text-muted-foreground">{formatDate(approval.createdAt)}{approval.reviewedAt && <p className="mt-1 text-[11px] text-muted-foreground">Reviewed {formatDate(approval.reviewedAt)}</p>}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
