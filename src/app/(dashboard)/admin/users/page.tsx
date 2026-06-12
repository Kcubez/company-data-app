'use client';

import {
  useUsers,
  useDeleteUser,
  useBanUser,
  useUnbanUser,
  useCreateUser,
} from '@/hooks/use-users';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserFormValues,
  type UpdateUserFormValues,
} from '@/lib/validations';
import { format } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { userKeys } from '@/hooks/use-users';
import {
  Shield,
  ShieldAlert,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Ban,
  Unlock,
  Edit,
  Loader2,
  Users,
  Eye,
  EyeOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { AdminUser } from '@/lib/api';

export default function AdminUsersPage() {
  const { data: users, isLoading } = useUsers();
  const [searchTerm, setSearchTerm] = useState('');
  const deleteUser = useDeleteUser();
  const banUser = useBanUser();
  const unbanUser = useUnbanUser();
  const createUser = useCreateUser();
  const queryClient = useQueryClient();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [showCreatePassword, setShowCreatePassword] = useState(false);

  const createForm = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: '', email: '', password: '', role: 'user' },
  });

  const editForm = useForm<UpdateUserFormValues>({
    resolver: zodResolver(updateUserSchema),
    defaultValues: { name: '', email: '', role: 'user' },
  });

  const onCreateSubmit = async (values: CreateUserFormValues) => {
    await createUser.mutateAsync(values);
    setIsCreateOpen(false);
    createForm.reset();
  };

  const openEditModal = (user: AdminUser) => {
    setEditingUser(user);
    editForm.reset({
      name: user.name,
      email: user.email,
      role: user.role as 'user' | 'admin',
    });
    setIsEditOpen(true);
  };

  const handleUpdate = async (values: UpdateUserFormValues) => {
    if (!editingUser) return;
    try {
      toast.promise(
        fetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        }).then(res => {
          if (!res.ok) throw new Error('Failed to update');
          return res.json();
        }),
        {
          loading: 'Updating user...',
          success: () => {
            setIsEditOpen(false);
            setEditingUser(null);
            queryClient.invalidateQueries({ queryKey: userKeys.lists() });
            return 'User updated successfully';
          },
          error: 'Failed to update user',
        }
      );
    } catch (e) {
      console.error(e);
    }
  };

  const filteredUsers =
    users?.filter(
      u =>
        u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        u.email.toLowerCase().includes(searchTerm.toLowerCase())
    ) ?? [];

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold  text-foreground mb-2">User Management</h1>
          <p className="text-muted-foreground">Manage your system users, roles, and access.</p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger render={<Button className="bg-blue-600 hover:bg-blue-500 text-white shadow-sm" />}>
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </DialogTrigger>
          <DialogContent className="bg-card border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="text-foreground">Create New User</DialogTitle>
              <DialogDescription className="text-muted-foreground">
                Add a new user manually to the system.
              </DialogDescription>
            </DialogHeader>
            <Form {...createForm}>
              <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4 pt-4">
                <FormField
                  control={createForm.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">Name</FormLabel>
                      <FormControl>
                        <Input
                          className="bg-muted border-border text-foreground"
                          placeholder="John Doe"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-600 dark:text-red-400" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">Email</FormLabel>
                      <FormControl>
                        <Input
                          type="email"
                          className="bg-muted border-border text-foreground"
                          placeholder="john@example.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage className="text-red-600 dark:text-red-400" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            type={showCreatePassword ? "text" : "password"}
                            className="bg-muted border-border text-foreground pr-10"
                            placeholder="••••••••"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowCreatePassword((p) => !p)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-foreground"
                          >
                            {showCreatePassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage className="text-red-600 dark:text-red-400" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={createForm.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">Role</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger className="bg-muted border-border text-foreground">
                            <SelectValue placeholder="Select a role" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="bg-muted border-border text-foreground">
                          <SelectItem value="user">User</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage className="text-red-600 dark:text-red-400" />
                    </FormItem>
                  )}
                />
                <div className="flex justify-end pt-4">
                  <Button
                    type="submit"
                    disabled={createForm.formState.isSubmitting}
                    className="bg-blue-600 hover:bg-blue-500 text-white"
                  >
                    {createForm.formState.isSubmitting && (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    )}
                    Create User
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="bg-card border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">Edit User</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Update details for {editingUser?.email}.
            </DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(handleUpdate)} className="space-y-4 pt-4">
              <FormField
                control={editForm.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Name</FormLabel>
                    <FormControl>
                      <Input
                        className="bg-muted border-border text-foreground"
                        placeholder="John Doe"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-red-600 dark:text-red-400" />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        className="bg-muted border-border text-foreground"
                        placeholder="john@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage className="text-red-600 dark:text-red-400" />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="role"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Role</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger className="bg-muted border-border text-foreground">
                          <SelectValue placeholder="Select a role" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent className="bg-muted border-border text-foreground">
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage className="text-red-600 dark:text-red-400" />
                  </FormItem>
                )}
              />
              <div className="flex justify-end pt-4">
                <Button
                  type="submit"
                  disabled={editForm.formState.isSubmitting}
                  className="bg-blue-600 hover:bg-blue-500 text-white"
                >
                  {editForm.formState.isSubmitting && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Save Changes
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <div className="bg-card border border-border rounded-lg overflow-hidden shadow-sm">
        <div className="p-4 border-b border-border bg-muted/50 flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <Input
              placeholder="Search users..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9 bg-muted/50 border-border text-foreground placeholder:text-muted-foreground focus-visible:ring-blue-500"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50 hover:bg-muted/50">
              <TableRow className="border-border">
                <TableHead className="text-muted-foreground font-medium">User</TableHead>
                <TableHead className="text-muted-foreground font-medium">Role</TableHead>
                <TableHead className="text-muted-foreground font-medium">Status</TableHead>
                <TableHead className="text-muted-foreground font-medium whitespace-nowrap">
                  Joined Date
                </TableHead>
                <TableHead className="text-right text-muted-foreground font-medium">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i} className="border-border transition-colors">
                    <TableCell>
                      <Skeleton className="h-10 w-48 bg-muted" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-16 bg-muted rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-6 w-20 bg-muted rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24 bg-muted" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Skeleton className="h-8 w-8 ml-auto bg-muted" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredUsers.length === 0 ? (
                <TableRow className="border-border hover:bg-muted/30">
                  <TableCell colSpan={5} className="text-center py-12 text-muted-foreground">
                    <div className="flex flex-col items-center justify-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
                        <Users className="w-6 h-6 text-slate-500" />
                      </div>
                      <p>No users found matching your search.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredUsers.map(user => (
                  <TableRow
                    key={user.id}
                    className="border-border hover:bg-muted/60 transition-colors"
                  >
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border border-border bg-muted">
                          <AvatarFallback className="bg-blue-500/20 text-blue-600 dark:text-blue-400 text-sm">
                            {user.name?.[0]?.toUpperCase() ?? 'U'}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="font-medium text-foreground/85">{user.name}</span>
                          <span className="text-xs text-muted-foreground">{user.email}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={user.role === 'admin' ? 'default' : 'secondary'}
                        className={
                          user.role === 'admin'
                            ? 'bg-blue-500/20 text-blue-600 dark:text-blue-400 border-blue-500/30'
                            : 'bg-muted text-muted-foreground'
                        }
                      >
                        {user.role === 'admin' ? <Shield className="w-3 h-3 mr-1" /> : null}
                        {user.role}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {user.banned ? (
                        <div className="flex flex-col">
                          <Badge
                            variant="destructive"
                            className="bg-red-500/20 text-red-600 dark:text-red-400 border-red-500/30 w-fit"
                          >
                            Banned
                          </Badge>
                          <span
                            className="text-[10px] text-slate-500 mt-1 max-w-37.5 truncate"
                            title={user.banReason ?? ''}
                          >
                            {user.banReason}
                          </span>
                        </div>
                      ) : (
                        <Badge
                          variant="outline"
                          className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                        >
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(user.createdAt), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button
                            variant="ghost"
                            size="icon"
                            className="text-muted-foreground hover:text-foreground hover:bg-muted"
                          />}>
                            <MoreVertical className="w-4 h-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                          align="end"
                          className="bg-card border-border text-foreground"
                        >
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuSeparator className="bg-muted" />
                          <DropdownMenuItem
                            className="hover:bg-muted cursor-pointer text-foreground"
                            onClick={() => openEditModal(user)}
                          >
                            <Edit className="w-4 h-4 mr-2" /> Edit Details
                          </DropdownMenuItem>

                          {user.banned ? (
                            <DropdownMenuItem
                              className="hover:bg-muted cursor-pointer text-emerald-600 dark:text-emerald-400 focus:text-emerald-700 dark:text-emerald-300 focus:bg-emerald-500/10"
                              onClick={() => unbanUser.mutate(user.id)}
                            >
                              <Unlock className="w-4 h-4 mr-2" /> Unban User
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              className="hover:bg-muted cursor-pointer text-amber-600 dark:text-amber-500 focus:text-amber-600 dark:text-amber-400 focus:bg-amber-500/10"
                              onClick={() => {
                                const reason = window.prompt(
                                  'Reason for banning:',
                                  'Violation of terms'
                                );
                                if (reason !== null) banUser.mutate({ id: user.id, reason });
                              }}
                            >
                              <Ban className="w-4 h-4 mr-2" /> Ban User
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator className="bg-muted" />
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400 focus:text-red-700 dark:text-red-300 hover:bg-red-500/10 cursor-pointer"
                            onClick={() => {
                              if (
                                confirm(
                                  `Are you sure you want to permanently delete ${user.email}?`
                                )
                              ) {
                                deleteUser.mutate(user.id);
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" /> Delete Account
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
