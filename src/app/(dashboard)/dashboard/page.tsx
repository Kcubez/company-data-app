'use client';

import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/lib/auth-client';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Users,
  Activity,
  MessageSquare,
  CalendarDays,
  TrendingUp,
  Bot,
  CheckCircle2,
  XCircle,
  Send,
} from 'lucide-react';

type DashboardStats = {
  totalMessages: number;
  todayMessages: number;
  totalSenders: number;
  weekMessages: number;
  botActive: boolean;
  recentMessages: {
    id: string;
    text: string;
    senderName: string;
    senderUsername: string | null;
    receivedAt: string;
  }[];
  isAdmin: boolean;
  adminStats: {
    totalUsers: number;
    activeSessions: number;
  } | null;
};

function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const res = await fetch('/api/dashboard/stats');
      if (!res.ok) throw new Error('Failed to fetch');
      return res.json();
    },
    refetchInterval: 10000,
  });
}

export default function DashboardPage() {
  const { data: session } = useSession();
  const { data: stats, isLoading } = useDashboardStats();
  const user = session?.user;
  const isAdmin = stats?.isAdmin ?? false;

  // Build stat cards based on role
  const statCards = isAdmin
    ? [
        {
          title: 'Account Users',
          value: stats?.adminStats?.totalUsers ?? 0,
          icon: Users,
          color: 'text-blue-400',
          bg: 'bg-blue-500/10',
          border: 'border-blue-500/20',
        },
        {
          title: 'Active Sessions',
          value: stats?.adminStats?.activeSessions ?? 0,
          icon: Activity,
          color: 'text-emerald-400',
          bg: 'bg-emerald-500/10',
          border: 'border-emerald-500/20',
        },
        {
          title: 'Telegram Senders',
          value: stats?.totalSenders ?? 0,
          icon: Send,
          color: 'text-purple-400',
          bg: 'bg-purple-500/10',
          border: 'border-purple-500/20',
        },
        {
          title: 'Total Messages',
          value: stats?.totalMessages ?? 0,
          icon: MessageSquare,
          color: 'text-amber-400',
          bg: 'bg-amber-500/10',
          border: 'border-amber-500/20',
        },
      ]
    : [
        {
          title: 'Telegram Senders',
          value: stats?.totalSenders ?? 0,
          icon: Send,
          color: 'text-blue-400',
          bg: 'bg-blue-500/10',
          border: 'border-blue-500/20',
        },
        {
          title: 'Total Messages',
          value: stats?.totalMessages ?? 0,
          icon: MessageSquare,
          color: 'text-emerald-400',
          bg: 'bg-emerald-500/10',
          border: 'border-emerald-500/20',
        },
        {
          title: "Today's Messages",
          value: stats?.todayMessages ?? 0,
          icon: CalendarDays,
          color: 'text-purple-400',
          bg: 'bg-purple-500/10',
          border: 'border-purple-500/20',
        },
        {
          title: 'This Week',
          value: stats?.weekMessages ?? 0,
          icon: TrendingUp,
          color: 'text-amber-400',
          bg: 'bg-amber-500/10',
          border: 'border-amber-500/20',
        },
      ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white mb-2">
          Welcome back, {user?.name}
        </h1>
        <p className="text-slate-400">
          {isAdmin
            ? 'System overview and recent activity.'
            : 'Your Telegram bot overview and recent messages.'}
        </p>
      </div>

      {/* Stat Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat, i) => (
          <Card
            key={i}
            className={`bg-slate-900 border-slate-800 shadow-lg hover:${stat.border} transition-all duration-300`}
          >
            <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
              <CardTitle className="text-sm font-medium text-slate-400">
                {stat.title}
              </CardTitle>
              <div className={`p-2 rounded-xl ${stat.bg}`}>
                <stat.icon className={`h-4 w-4 ${stat.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20 bg-slate-800" />
              ) : (
                <div className="text-3xl font-bold text-white">
                  {stat.value.toLocaleString()}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bottom Section */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Messages */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white">Recent Messages</CardTitle>
            <CardDescription className="text-slate-400">
              Latest messages from your Telegram bot
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50">
                    <Skeleton className="w-9 h-9 rounded-full bg-slate-700" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3.5 w-24 bg-slate-700" />
                      <Skeleton className="h-3 w-full bg-slate-700" />
                    </div>
                  </div>
                ))
              ) : stats?.recentMessages && stats.recentMessages.length > 0 ? (
                stats.recentMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="flex items-start gap-3 p-3 rounded-xl bg-slate-800/50 hover:bg-slate-800 transition-colors"
                  >
                    <Avatar className="h-9 w-9 border border-slate-700 shrink-0">
                      <AvatarFallback className="bg-indigo-500/20 text-indigo-400 text-xs font-medium">
                        {msg.senderName?.[0]?.toUpperCase() ?? 'T'}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-sm font-medium text-white truncate">
                          {msg.senderName}
                        </span>
                        <span className="text-xs text-slate-500 shrink-0">
                          {formatDistanceToNow(new Date(msg.receivedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate">{msg.text}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8">
                  <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-sm text-slate-500">No messages yet</p>
                  <p className="text-xs text-slate-600 mt-1">
                    Send a message to your bot to see it here
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Bot Status Card */}
        <Card className="bg-slate-900 border-slate-800 shadow-lg">
          <CardHeader>
            <CardTitle className="text-white flex items-center gap-2">
              <Bot className="w-5 h-5 text-indigo-400" />
              Bot Status
            </CardTitle>
            <CardDescription className="text-slate-400">
              Your Telegram bot connection status
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-full bg-slate-800 rounded-xl" />
                <Skeleton className="h-16 w-full bg-slate-800 rounded-xl" />
              </div>
            ) : (
              <>
                {/* Connection Status */}
                <div className={`flex items-center gap-4 p-4 rounded-xl ${
                  stats?.botActive
                    ? 'bg-emerald-500/5 border border-emerald-500/20'
                    : 'bg-slate-800/50 border border-slate-700/50'
                }`}>
                  {stats?.botActive ? (
                    <CheckCircle2 className="w-8 h-8 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-8 h-8 text-slate-500 shrink-0" />
                  )}
                  <div>
                    <p className={`font-medium ${stats?.botActive ? 'text-emerald-300' : 'text-slate-300'}`}>
                      {stats?.botActive ? 'Bot is connected' : 'Bot not configured'}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {stats?.botActive
                        ? 'Receiving messages in real-time'
                        : 'Go to Settings to add your bot token'}
                    </p>
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl bg-slate-800/50">
                    <p className="text-xs text-slate-500 mb-1">Today</p>
                    <p className="text-2xl font-bold text-white">
                      {(stats?.todayMessages ?? 0).toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">messages</p>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-800/50">
                    <p className="text-xs text-slate-500 mb-1">This Week</p>
                    <p className="text-2xl font-bold text-white">
                      {(stats?.weekMessages ?? 0).toLocaleString()}
                    </p>
                    <p className="text-xs text-slate-500">messages</p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
