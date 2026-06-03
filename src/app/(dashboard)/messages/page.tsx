'use client';

import { useState, useEffect, useCallback } from 'react';
import { useMessages, useMessageStats, useDeleteMessage } from '@/hooks/use-messages';
import { useSenders } from '@/hooks/use-senders';
import { useSession } from '@/lib/auth-client';
import { formatDistanceToNow } from 'date-fns';
import {
  MessageSquare,
  CalendarDays,
  Users,
  TrendingUp,
  Search,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Radio,
  ClipboardList,
  PhoneCall,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { TelegramSender } from '@/lib/api';

export default function MessagesPage() {
  const { data: session } = useSession();
  const isAdmin = session?.user?.role === 'admin';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedSenderId, setSelectedSenderId] = useState<string | undefined>(undefined);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1); // Reset to page 1 on search
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: messagesData, isLoading: messagesLoading } = useMessages({
    page,
    limit: 20,
    search: debouncedSearch || undefined,
    senderId: selectedSenderId,
  });

  const { data: stats, isLoading: statsLoading } = useMessageStats();
  const { data: senders, isLoading: sendersLoading } = useSenders();
  const deleteMessage = useDeleteMessage();

  const handleSenderFilter = useCallback((senderId: string | undefined) => {
    setSelectedSenderId(senderId);
    setPage(1);
  }, []);

  const statCards = [
    {
      title: 'Total Messages',
      value: stats?.totalMessages ?? 0,
      icon: MessageSquare,
      color: 'text-blue-400',
      bg: 'bg-blue-500/10',
      border: 'border-blue-500/20',
    },
    {
      title: "Today's Messages",
      value: stats?.todayMessages ?? 0,
      icon: CalendarDays,
      color: 'text-emerald-400',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
    },
    {
      title: 'Business Reports',
      value: stats?.businessReports ?? 0,
      icon: ClipboardList,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/10',
      border: 'border-cyan-500/20',
    },
    {
      title: 'Future Plans',
      value: stats?.futurePlans ?? 0,
      icon: PhoneCall,
      color: 'text-purple-400',
      bg: 'bg-purple-500/10',
      border: 'border-purple-500/20',
    },
    {
      title: 'Total Senders',
      value: stats?.totalSenders ?? 0,
      icon: Users,
      color: 'text-rose-400',
      bg: 'bg-rose-500/10',
      border: 'border-rose-500/20',
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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-3xl font-bold tracking-tight text-white">
              Messages
            </h1>
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20">
              <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
              <span className="text-xs font-medium text-emerald-400">Live</span>
            </div>
          </div>
          <p className="text-slate-400">
            Real-time data from your Telegram bot
          </p>
        </div>
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search messages..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-slate-800/50 border-slate-700 text-white placeholder:text-slate-500 focus-visible:ring-indigo-500"
          />
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
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
              {statsLoading ? (
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

      {/* Main Content: Senders + Messages */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Senders Sidebar */}
        <div className="w-full lg:w-72 shrink-0">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 space-y-1 lg:sticky lg:top-6">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-3 py-2">
              Senders
            </h3>

            {/* All Messages button */}
            <button
              onClick={() => handleSenderFilter(undefined)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-left ${
                !selectedSenderId
                  ? 'bg-indigo-500/10 text-indigo-400 font-medium'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                !selectedSenderId ? 'bg-indigo-500/20' : 'bg-slate-800'
              }`}>
                <Inbox className="w-4 h-4" />
              </div>
              <span className="text-sm">All Messages</span>
              {messagesData && !selectedSenderId && (
                <Badge variant="secondary" className="ml-auto bg-slate-800 text-slate-300 text-xs">
                  {messagesData.total}
                </Badge>
              )}
            </button>

            {/* Senders List */}
            {sendersLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <Skeleton className="w-8 h-8 rounded-full bg-slate-800" />
                  <div className="flex-1">
                    <Skeleton className="h-4 w-24 bg-slate-800 mb-1" />
                    <Skeleton className="h-3 w-16 bg-slate-800" />
                  </div>
                </div>
              ))
            ) : senders && senders.length > 0 ? (
              senders.map((sender: TelegramSender) => (
                <SenderItem
                  key={sender.id}
                  sender={sender}
                  isSelected={selectedSenderId === sender.id}
                  onClick={() => handleSenderFilter(
                    selectedSenderId === sender.id ? undefined : sender.id
                  )}
                />
              ))
            ) : (
              <p className="text-xs text-slate-500 px-3 py-4 text-center">
                No senders yet
              </p>
            )}
          </div>
        </div>

        {/* Messages Feed */}
        <div className="flex-1 min-w-0">
          <div className="space-y-3">
            {messagesLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <MessageSkeleton key={i} />
              ))
            ) : messagesData && messagesData.messages.length > 0 ? (
              messagesData.messages.map((message) => (
                <div
                  key={message.id}
                  className="group bg-slate-900/50 border border-slate-800/50 rounded-xl p-4 hover:bg-slate-800/30 hover:border-slate-700/50 transition-all duration-200"
                >
                  <div className="flex items-start gap-3">
                    {/* Sender Avatar */}
                    <Avatar className="h-10 w-10 border border-slate-700 bg-slate-800 shrink-0">
                      <AvatarFallback className="bg-indigo-500/20 text-indigo-400 text-sm font-medium">
                        {message.sender?.displayName?.[0]?.toUpperCase() ?? 'T'}
                      </AvatarFallback>
                    </Avatar>

                    {/* Message Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-slate-200 text-sm">
                          {message.sender?.displayName ?? 'Unknown'}
                        </span>
                        {message.sender?.username && (
                          <span className="text-xs text-slate-500">
                            @{message.sender.username}
                          </span>
                        )}
                        <span className="text-xs text-slate-600 ml-auto shrink-0">
                          {formatDistanceToNow(new Date(message.receivedAt), {
                            addSuffix: true,
                          })}
                        </span>
                      </div>

                      <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap break-words">
                        {message.text}
                      </p>

                      {message.chatTitle && (
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="text-xs text-slate-500">
                            💬 {message.chatTitle}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Delete button with custom AlertDialog */}
                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <button
                            type="button"
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-lg hover:bg-red-500/10 text-slate-500 hover:text-red-400 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/30 transition-colors"
                            title="Delete message"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        }
                      />
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete message?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to permanently delete this message? This action cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            onClick={() => deleteMessage.mutate(message.id)}
                            className="bg-red-600 hover:bg-red-700 text-white"
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState search={debouncedSearch} selectedSenderId={selectedSenderId} />
            )}
          </div>

          {/* Pagination */}
          {messagesData && messagesData.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-6">
              <Button
                variant="ghost"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              {generatePageNumbers(page, messagesData.totalPages).map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="text-slate-500 px-1">
                    ···
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant="ghost"
                    size="icon"
                    onClick={() => setPage(p as number)}
                    className={`w-9 h-9 ${
                      page === p
                        ? 'bg-indigo-500/20 text-indigo-400 font-medium'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800'
                    }`}
                  >
                    {p}
                  </Button>
                )
              )}

              <Button
                variant="ghost"
                size="icon"
                disabled={page >= messagesData.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>

              <span className="text-xs text-slate-500 ml-2">
                {messagesData.total} messages
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub Components ─────────────────────────────────────────────────────────

function SenderItem({
  sender,
  isSelected,
  onClick,
}: {
  sender: TelegramSender;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 text-left ${
        isSelected
          ? 'bg-indigo-500/10 text-indigo-400'
          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
      }`}
    >
      <Avatar className="h-8 w-8 border border-slate-700">
        <AvatarFallback
          className={`text-xs font-medium ${
            isSelected
              ? 'bg-indigo-500/20 text-indigo-400'
              : 'bg-slate-800 text-slate-400'
          }`}
        >
          {sender.displayName?.[0]?.toUpperCase() ?? 'U'}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isSelected ? 'font-medium' : ''}`}>
          {sender.displayName}
        </p>
        {sender.username && (
          <p className="text-xs text-slate-500 truncate">@{sender.username}</p>
        )}
      </div>
      <Badge
        variant="secondary"
        className={`text-xs shrink-0 ${
          isSelected
            ? 'bg-indigo-500/20 text-indigo-400'
            : 'bg-slate-800 text-slate-500'
        }`}
      >
        {sender.messageCount}
      </Badge>
    </button>
  );
}

function MessageSkeleton() {
  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="w-10 h-10 rounded-full bg-slate-800" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-4 w-28 bg-slate-800" />
            <Skeleton className="h-3 w-16 bg-slate-800" />
          </div>
          <Skeleton className="h-4 w-full bg-slate-800" />
          <Skeleton className="h-4 w-2/3 bg-slate-800" />
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  search,
  selectedSenderId,
}: {
  search: string;
  selectedSenderId: string | undefined;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="w-16 h-16 rounded-2xl bg-slate-800/50 flex items-center justify-center mb-4">
        <MessageSquare className="w-8 h-8 text-slate-600" />
      </div>
      {search ? (
        <>
          <h3 className="text-lg font-medium text-slate-300 mb-1">
            No results found
          </h3>
          <p className="text-sm text-slate-500 max-w-sm">
            No messages matching &quot;{search}&quot;. Try a different search term.
          </p>
        </>
      ) : selectedSenderId ? (
        <>
          <h3 className="text-lg font-medium text-slate-300 mb-1">
            No messages from this sender
          </h3>
          <p className="text-sm text-slate-500 max-w-sm">
            This sender hasn&apos;t sent any messages yet, or all messages have been deleted.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-lg font-medium text-slate-300 mb-1">
            No messages yet
          </h3>
          <p className="text-sm text-slate-500 max-w-sm">
            Set up your Telegram bot webhook to start receiving data from your business owners.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generatePageNumbers(
  current: number,
  total: number
): (number | string)[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | string)[] = [1];

  if (current > 3) {
    pages.push('...');
  }

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);

  for (let i = start; i <= end; i++) {
    pages.push(i);
  }

  if (current < total - 2) {
    pages.push('...');
  }

  pages.push(total);

  return pages;
}
