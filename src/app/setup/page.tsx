import { prisma } from '@/lib/prisma';
import { redirect } from 'next/navigation';
import { SetupForm } from '@/app/setup/setup-form';

export const metadata = {
  title: 'Initial System Setup',
};

export default async function SetupPage() {
  // Security Check: If a user already exists, bounce to login.
  // This page is strictly for the FIRST deployment setup.
  const userCount = await prisma.user.count();

  if (userCount > 0) {
    redirect('/admin/login');
  }

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-4 relative overflow-hidden">
      {/* Background decorations */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-150 h-150 bg-indigo-500/20 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="w-full max-w-md relative z-10">
        <div className="text-center mb-10">
          <div className="w-16 h-16 bg-linear-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center mb-6 shadow-xl shadow-indigo-500/20">
            <svg
              className="w-8 h-8 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">
            System Initialization
          </h1>
          <p className="text-slate-400">
            Welcome to the StarterKit. Create the first super-admin account to unlock the system.
          </p>
        </div>

        <SetupForm />
      </div>
    </div>
  );
}
