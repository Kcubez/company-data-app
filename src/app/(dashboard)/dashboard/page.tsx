import { auth } from '@/lib/auth';
import { headers } from 'next/headers';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LayoutDashboard, Users, Activity, Settings } from 'lucide-react';

export const metadata = {
  title: 'Dashboard',
};

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const user = session?.user;

  const stats = [
    {
      title: 'Total Users',
      value: '1,234',
      icon: Users,
      color: 'text-blue-500',
      bg: 'bg-blue-500/10',
    },
    {
      title: 'Active Sessions',
      value: '856',
      icon: Activity,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
    },
    {
      title: 'Projects',
      value: '12',
      icon: LayoutDashboard,
      color: 'text-purple-500',
      bg: 'bg-purple-500/10',
    },
    {
      title: 'System Health',
      value: '99.9%',
      icon: Settings,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
          Welcome back, {user?.name}
        </h1>
        <p className="text-slate-400">Here is an overview of your account and system status.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat, i) => (
          <Card
            key={i}
            className="bg-slate-900 border-slate-800 shadow-lg hover:border-slate-700 transition-all duration-300"
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-400">{stat.title}</CardTitle>
              <div className={`p-2 rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold text-white">{stat.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="bg-slate-900 border-slate-800 shadow-lg col-span-1">
          <CardHeader>
            <CardTitle className="text-white">Recent Activity</CardTitle>
            <CardDescription className="text-slate-400">
              Your latest actions in the system.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {[1, 2, 3].map(i => (
                <div
                  key={i}
                  className="flex items-center gap-4 p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-slate-400" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Action recorded</p>
                    <p className="text-xs text-slate-400">Just now</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-linear-to-br from-indigo-900/50 to-purple-900/50 border-indigo-500/20 shadow-lg col-span-1 relative overflow-hidden group">
          <div className="absolute inset-0 bg-linear-to-br from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          <CardHeader>
            <CardTitle className="text-indigo-100 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
              Quick Setup Guide
            </CardTitle>
          </CardHeader>
          <CardContent className="text-slate-300">
            <ol className="list-decimal pl-4 space-y-2 mt-4 marker:text-indigo-400">
              <li>Configure your Prisma Schema</li>
              <li>Set up Supabase tables</li>
              <li>Connect Next.js Admin</li>
            </ol>
            <button className="mt-8 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors w-full shadow-lg shadow-indigo-500/20">
              View Documentation
            </button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
