'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Eye, EyeOff, Loader2, LogIn, Mail, Lock } from 'lucide-react';
import { loginSchema, type LoginFormValues } from '@/lib/validations';
import { signIn } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

export function LoginForm({ requiredRole }: { requiredRole?: "admin" | "user" }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') ?? '/dashboard';
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState('');

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError('');
    const { data, error } = await signIn.email({
      email: values.email,
      password: values.password,
    });

    if (error) {
      setServerError(error.message ?? 'Invalid credentials. Please try again.');
      return;
    }

    // Role Enforcement
    if (requiredRole && data?.user?.role && data.user.role !== requiredRole) {
      const { signOut } = await import('@/lib/auth-client');
      await signOut();
      setServerError(`Access denied. This portal is strictly for ${requiredRole}s.`);
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  };

  const isLoading = form.formState.isSubmitting;

  return (
    <Card className="border-slate-800/80 bg-slate-900/40 backdrop-blur-xl shadow-2xl shadow-black/45 rounded-2xl ring-1 ring-white/5 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
      <CardHeader className="space-y-1.5 pb-6 pt-8 px-6 border-b border-slate-800/50 bg-slate-950/20 text-center">
        <CardTitle className="text-2xl font-extrabold text-white tracking-tight">Welcome back</CardTitle>
        <CardDescription className="text-slate-400 text-sm">
          Sign in to your account to continue
        </CardDescription>
      </CardHeader>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)}>
          <CardContent className="space-y-5 p-6">
            {serverError && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3.5 text-xs font-medium text-red-400 flex items-center gap-2 animate-in fade-in duration-200">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                {serverError}
              </div>
            )}

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-slate-300 text-xs font-semibold uppercase tracking-wider">Email Address</FormLabel>
                  <FormControl>
                    <div className="relative group">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors duration-200" />
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        className="pl-10 h-11 bg-slate-950/40 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/40 rounded-xl transition-all duration-200 text-sm font-sans"
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs mt-1" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem className="space-y-1.5">
                  <FormLabel className="text-slate-300 text-xs font-semibold uppercase tracking-wider">Password</FormLabel>
                  <FormControl>
                    <div className="relative group">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 group-focus-within:text-indigo-400 transition-colors duration-200" />
                      <Input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        autoComplete="current-password"
                        className="pl-10 pr-10 h-11 bg-slate-950/40 border-slate-800 text-white placeholder:text-slate-600 focus-visible:ring-indigo-500/40 focus-visible:border-indigo-500/40 rounded-xl transition-all duration-200 text-sm font-sans"
                        {...field}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(p => !p)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors p-0.5 rounded"
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </FormControl>
                  <FormMessage className="text-red-400 text-xs mt-1" />
                </FormItem>
              )}
            />
          </CardContent>

          <CardFooter className="flex flex-col gap-4 p-6 pt-2 border-t border-slate-800/50 bg-slate-950/10">
            <Button
              id="login-submit"
              type="submit"
              className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer"
              disabled={isLoading}
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </CardFooter>
        </form>
      </Form>
    </Card>
  );
}
