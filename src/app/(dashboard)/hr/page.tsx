'use client';

import { useState } from 'react';
import {
  useHRStaff,
  useCreateHRStaff,
  useUpdateHRStaff,
  useDeleteHRStaff,
} from '@/hooks/use-hr';
import { TelegramSender } from '@/lib/api';
import {
  Users,
  UserPlus,
  Shield,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Layers,
  MoreVertical,
  Edit2,
  Trash2,
  Building2,
  Mail,
  Loader2,
  AlertCircle,
  MessageSquare,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from 'sonner';

const DEPARTMENTS = [
  {
    key: 'Sales',
    label: 'Sales & Marketing',
    color: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300',
    iconColor: 'text-amber-500',
    description: 'Access to submit Sales, Deals, and Customer leads',
  },
  {
    key: 'IT',
    label: 'IT & Systems',
    color: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300',
    iconColor: 'text-sky-500',
    description: 'Access to submit Project Expiries & Website updates',
  },
  {
    key: 'Finance',
    label: 'Finance & Ops',
    color: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300',
    iconColor: 'text-emerald-500',
    description: 'Access to submit Expenses, COGS, Salaries & KPI reports',
  },
  {
    key: 'QA',
    label: 'QA & Support',
    color: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900/60 dark:bg-purple-950/40 dark:text-purple-300',
    iconColor: 'text-purple-500',
    description: 'Access to ask questions to Gemini AI chatbot',
  },
];

export default function HRManagementPage() {
  const { data, isLoading, error } = useHRStaff();
  const createStaff = useCreateHRStaff();
  const updateStaff = useUpdateHRStaff();
  const deleteStaff = useDeleteHRStaff();

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('all');

  // Modals state
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [addEmail, setAddEmail] = useState('');
  const [addAllowedDeps, setAddAllowedDeps] = useState<string[]>(['Sales', 'IT', 'Finance', 'QA']);

  const [editingStaff, setEditingStaff] = useState<TelegramSender | null>(null);
  const [editIsAuthorized, setEditIsAuthorized] = useState(false);
  const [editIsDataApprover, setEditIsDataApprover] = useState(false);
  const [editAllowedDeps, setEditAllowedDeps] = useState<string[]>([]);

  const [deletingStaff, setDeletingStaff] = useState<TelegramSender | null>(null);

  const staffList = data?.staff || [];
  const summary = data?.summary || {
    totalStaff: 0,
    authorizedStaff: 0,
    pendingStaff: 0,
    departmentCounts: { Sales: 0, IT: 0, Finance: 0, QA: 0 },
  };

  // Filtered staff
  const filteredStaff = staffList.filter((staff) => {
    const matchesSearch =
      !searchQuery ||
      (staff.displayName && staff.displayName.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (staff.email && staff.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (staff.username && staff.username.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (selectedDeptFilter === 'all') return true;
    if (selectedDeptFilter === 'pending') return staff.isAuthorized && !staff.isVerified;
    if (selectedDeptFilter === 'authorized') return staff.isAuthorized && staff.isVerified;
    return staff.allowedDepartments?.includes(selectedDeptFilter);
  });

  const handleAddStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!addEmail || !addEmail.includes('@')) {
      toast.error('Please enter a valid email address');
      return;
    }
    if (addAllowedDeps.length === 0) {
      toast.error('Please select at least one department');
      return;
    }

    createStaff.mutate(
      { email: addEmail, allowedDepartments: addAllowedDeps },
      {
        onSuccess: () => {
          setIsAddModalOpen(false);
          setAddEmail('');
          setAddAllowedDeps(['Sales', 'IT', 'Finance', 'QA']);
        },
      }
    );
  };

  const openEditModal = (staff: TelegramSender) => {
    setEditingStaff(staff);
    setEditIsAuthorized(staff.isAuthorized ?? false);
    setEditIsDataApprover(staff.isDataApprover ?? false);
    setEditAllowedDeps(staff.allowedDepartments ?? []);
  };

  const handleSaveEditPermissions = () => {
    if (!editingStaff) return;
    updateStaff.mutate(
      {
        id: editingStaff.id,
        data: {
          isAuthorized: editIsAuthorized,
          isDataApprover: editIsDataApprover,
          allowedDepartments: editAllowedDeps,
        },
      },
      {
        onSuccess: () => {
          setEditingStaff(null);
        },
      }
    );
  };

  const handleConfirmDelete = () => {
    if (!deletingStaff) return;
    deleteStaff.mutate(deletingStaff.id, {
      onSuccess: () => {
        setDeletingStaff(null);
      },
    });
  };

  const toggleAddDep = (depKey: string) => {
    setAddAllowedDeps((prev) =>
      prev.includes(depKey) ? prev.filter((d) => d !== depKey) : [...prev, depKey]
    );
  };

  const toggleEditDep = (depKey: string) => {
    setEditAllowedDeps((prev) =>
      prev.includes(depKey) ? prev.filter((d) => d !== depKey) : [...prev, depKey]
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
          <p className="text-sm">Loading HR & Staff directory...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-4 text-rose-600 dark:text-rose-400">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle className="h-5 w-5" />
            Failed to load staff data
          </div>
          <p className="mt-1 text-sm">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Top Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            {/* <Users className="h-7 w-7 text-blue-600 dark:text-blue-400" /> */}
            <h1 className="font-heading text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              HR & Staff Management
            </h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage employees, assign department permissions, and control Telegram report ingestion access.
          </p>
        </div>

        <Button
          onClick={() => setIsAddModalOpen(true)}
          className="gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 font-semibold text-white shadow-md hover:from-blue-700 hover:to-indigo-700"
        >
          <UserPlus className="h-4 w-4" />
          Add Staff Member
        </Button>
      </div>

      {/* Summary KPI Cards Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card className="glass-card border-border/70 shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Total Employees
            </CardTitle>
            <Building2 className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-foreground">{summary.totalStaff}</div>
            <p className="mt-1 text-[11px] text-muted-foreground">Registered staff accounts</p>
          </CardContent>
        </Card>

        {DEPARTMENTS.map((dept) => {
          const count = summary.departmentCounts[dept.key as keyof typeof summary.departmentCounts] || 0;
          return (
            <Card key={dept.key} className="glass-card border-border/70 shadow-xs">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {dept.label}
                </CardTitle>
                <Layers className={`h-4 w-4 ${dept.iconColor}`} />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-black text-foreground">{count}</div>
                <p className="mt-1 text-[11px] text-muted-foreground">Verified active staff</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Search & Department Filters */}
      <Card className="glass-card border-border/70 shadow-xs">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Search input */}
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search staff by name, email, or handle..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-background/50 border-border/70"
              />
            </div>

            {/* Department Filter buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-semibold text-muted-foreground flex items-center gap-1">
                <Filter className="h-3.5 w-3.5" /> Department:
              </span>
              <Button
                variant={selectedDeptFilter === 'all' ? 'default' : 'outline'}
                size="xs"
                onClick={() => setSelectedDeptFilter('all')}
                className="rounded-full text-xs font-medium"
              >
                All ({summary.totalStaff})
              </Button>
              {DEPARTMENTS.map((dept) => (
                <Button
                  key={dept.key}
                  variant={selectedDeptFilter === dept.key ? 'default' : 'outline'}
                  size="xs"
                  onClick={() => setSelectedDeptFilter(dept.key)}
                  className="rounded-full text-xs font-medium"
                >
                  {dept.label} ({summary.departmentCounts[dept.key as keyof typeof summary.departmentCounts] || 0})
                </Button>
              ))}
              <Button
                variant={selectedDeptFilter === 'pending' ? 'default' : 'outline'}
                size="xs"
                onClick={() => setSelectedDeptFilter('pending')}
                className="rounded-full text-xs font-medium"
              >
                Pending ({summary.pendingStaff})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Staff Members Table */}
      <Card className="glass-card border-border/70 shadow-xs overflow-hidden">
        <CardHeader className="border-b border-border/40 bg-muted/20 pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-foreground flex items-center gap-2">
                <Shield className="h-4 w-4 text-blue-500" />
                Staff Directory ({filteredStaff.length})
              </CardTitle>
              <CardDescription className="text-xs">
                List of registered employees and their assigned department permissions
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {filteredStaff.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground text-sm">
              <Users className="mx-auto h-8 w-8 text-muted-foreground/40 mb-2" />
              No staff members found matching your search criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/40 text-[11px] font-bold uppercase tracking-wider text-muted-foreground border-b border-border/40">
                  <tr>
                    <th className="py-3 px-4">Staff Member</th>
                    <th className="py-3 px-4">Email / Identity</th>
                    <th className="py-3 px-4">Assigned Departments</th>
                    <th className="py-3 px-4">Access Status</th>
                    <th className="py-3 px-4">Activity</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredStaff.map((staff) => {
                    const deps = staff.allowedDepartments || [];
                    return (
                      <tr key={staff.id} className="hover:bg-muted/30 transition-colors">
                        {/* Name & Handle */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-600 font-bold text-xs dark:bg-blue-400/20 dark:text-blue-300">
                              {(staff.displayName || staff.firstName || staff.email || 'S').slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-foreground text-xs">
                                {staff.displayName || `${staff.firstName || ''} ${staff.lastName || ''}`.trim() || 'Staff Member'}
                              </p>
                              {staff.username ? (
                                <p className="text-[11px] text-muted-foreground">@{staff.username}</p>
                              ) : (
                                <p className="text-[11px] text-slate-400 dark:text-slate-500">ID: {staff.telegramUserId || 'Pre-authorized'}</p>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Email */}
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-1.5 text-muted-foreground">
                            <Mail className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                            <span className="truncate max-w-[180px] text-xs text-foreground font-medium">
                              {staff.email || 'No email attached'}
                            </span>
                          </div>
                        </td>

                        {/* Departments */}
                        <td className="py-3.5 px-4">
                          <div className="flex flex-wrap gap-1">
                            {deps.length > 0 ? (
                              deps.map((depKey) => {
                                const deptObj = DEPARTMENTS.find((d) => d.key === depKey);
                                return (
                                  <Badge
                                    key={depKey}
                                    variant="outline"
                                    className={`text-[10px] font-semibold px-2 py-0.5 ${deptObj?.color || 'border-slate-200 bg-slate-50 text-slate-700'}`}
                                  >
                                    {deptObj?.label || depKey}
                                  </Badge>
                                );
                              })
                            ) : (
                              <span className="text-[11px] text-rose-500 font-semibold italic">No departments assigned</span>
                            )}
                            {staff.isDataApprover && (
                              <Badge className="border-violet-200 bg-violet-50 text-[10px] font-semibold text-violet-700 dark:border-violet-900/60 dark:bg-violet-950/40 dark:text-violet-300">
                                Data Approver
                              </Badge>
                            )}
                          </div>
                        </td>

                        {/* Status */}
                        <td className="py-3.5 px-4">
                          {staff.isAuthorized && staff.isVerified ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1 text-[10px] font-bold">
                              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                              Authorized
                            </Badge>
                          ) : staff.isAuthorized ? (
                            <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1 text-[10px] font-bold">
                              <Clock className="h-3 w-3 text-amber-500" />
                              Awaiting Verification
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1 text-[10px] font-bold">
                              <Clock className="h-3 w-3 text-amber-500" />
                              Access Revoked
                            </Badge>
                          )}
                        </td>

                        {/* Activity */}
                        <td className="py-3.5 px-4">
                          <div className="space-y-0.5">
                            <p className="text-xs font-semibold text-foreground flex items-center gap-1">
                              <MessageSquare className="h-3 w-3 text-muted-foreground" />
                              {staff.messageCount || 0} reports
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {staff.lastMessageAt ? new Date(staff.lastMessageAt).toLocaleDateString() : 'Never active'}
                            </p>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3.5 px-4 text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button variant="ghost" size="icon-xs" className="h-7 w-7">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              }
                            />
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuLabel className="text-[11px]">Staff Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openEditModal(staff)}>
                                <Edit2 className="h-3.5 w-3.5 mr-2 text-blue-500" />
                                Edit Departments
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  updateStaff.mutate({
                                    id: staff.id,
                                    data: { isAuthorized: !staff.isAuthorized },
                                  })
                                }
                              >
                                <Shield className="h-3.5 w-3.5 mr-2 text-amber-500" />
                                {staff.isAuthorized ? 'Revoke Authorization' : 'Grant Authorization'}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeletingStaff(staff)}
                                className="text-rose-600 dark:text-rose-400 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-2" />
                                Revoke Staff Access
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Staff Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-blue-600" />
              Pre-authorize New Staff Member
            </DialogTitle>
            <DialogDescription className="text-xs">
              Add an employee email address and select allowed departments. They must complete the Telegram email verification before access becomes active.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAddStaffSubmit} className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="staff-email" className="text-xs font-bold">
                Employee Email Address
              </Label>
              <Input
                id="staff-email"
                type="email"
                placeholder="employee@company.com"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
              />
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-bold">Assign Departments</Label>
              <div className="grid gap-2.5">
                {DEPARTMENTS.map((dept) => {
                  const isChecked = addAllowedDeps.includes(dept.key);
                  return (
                    <div
                      key={dept.key}
                      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors duration-200 ${
                        isChecked
                          ? 'border-blue-500/60 bg-blue-500/5 dark:bg-blue-500/10'
                          : 'border-border/60 hover:bg-muted/30'
                      }`}
                    >
                      <Checkbox
                        id={`add-department-${dept.key}`}
                        checked={isChecked}
                        onCheckedChange={() => toggleAddDep(dept.key)}
                        className="mt-0.5"
                      />
                      <Label htmlFor={`add-department-${dept.key}`} className="cursor-pointer">
                        <p className="text-xs font-bold text-foreground">{dept.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{dept.description}</p>
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>

            <DialogFooter className="pt-3">
              <Button variant="outline" type="button" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createStaff.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
                {createStaff.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Staff Member
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Department Permissions Modal */}
      <Dialog open={Boolean(editingStaff)} onOpenChange={(open) => !open && setEditingStaff(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-blue-600" />
              Edit Staff Department Permissions
            </DialogTitle>
            <DialogDescription className="text-xs">
              Update department access for {editingStaff?.displayName || editingStaff?.email || 'Staff Member'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between rounded-lg border border-border/70 p-3 bg-muted/20">
              <div>
                <p className="text-xs font-bold text-foreground">Account Authorization</p>
                <p className="text-[11px] text-muted-foreground">Enable or suspend Telegram reporting access</p>
              </div>
              <Switch checked={editIsAuthorized} onCheckedChange={setEditIsAuthorized} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-violet-200/80 bg-violet-50/50 p-3 dark:border-violet-900/60 dark:bg-violet-950/20">
              <div>
                <p className="text-xs font-bold text-foreground">Data Approver</p>
                <p className="text-[11px] text-muted-foreground">Receives bot notifications and can approve or reject staff file submissions</p>
              </div>
              <Switch checked={editIsDataApprover} onCheckedChange={setEditIsDataApprover} disabled={!editIsAuthorized} />
            </div>

            <div className="space-y-3">
              <Label className="text-xs font-bold">Allowed Departments</Label>
              <div className="grid gap-2.5">
                {DEPARTMENTS.map((dept) => {
                  const isChecked = editAllowedDeps.includes(dept.key);
                  return (
                    <div
                      key={dept.key}
                      className={`flex items-start gap-3 rounded-lg border p-3 transition-colors duration-200 ${
                        isChecked
                          ? 'border-blue-500/60 bg-blue-500/5 dark:bg-blue-500/10'
                          : 'border-border/60 hover:bg-muted/30'
                      }`}
                    >
                      <Checkbox
                        id={`edit-department-${dept.key}`}
                        checked={isChecked}
                        onCheckedChange={() => toggleEditDep(dept.key)}
                        className="mt-0.5"
                      />
                      <Label htmlFor={`edit-department-${dept.key}`} className="cursor-pointer">
                        <p className="text-xs font-bold text-foreground">{dept.label}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{dept.description}</p>
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <DialogFooter className="pt-3">
            <Button variant="outline" onClick={() => setEditingStaff(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEditPermissions} disabled={updateStaff.isPending} className="bg-blue-600 hover:bg-blue-700 text-white">
              {updateStaff.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={Boolean(deletingStaff)} onOpenChange={(open) => !open && setDeletingStaff(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-rose-600 dark:text-rose-400 flex items-center gap-2">
              <AlertCircle className="h-5 w-5" /> Revoke Staff Access
            </DialogTitle>
            <DialogDescription className="text-xs">
              Are you sure you want to revoke access for {deletingStaff?.displayName || deletingStaff?.email || 'this staff member'}? Their Telegram and report history will be preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-3">
            <Button variant="outline" onClick={() => setDeletingStaff(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleteStaff.isPending}>
              {deleteStaff.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Revoke Access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
