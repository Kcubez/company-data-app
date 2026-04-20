import { LoginForm } from '@/components/auth/login-form';

export const metadata = {
  title: 'Sign in',
};

import { Suspense } from 'react';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="h-100 flex justify-center items-center text-slate-400">Loading form...</div>
      }
    >
      <LoginForm requiredRole="admin" />
    </Suspense>
  );
}
