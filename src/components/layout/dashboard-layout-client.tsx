'use client';

import { useSession, signOut } from '@/lib/auth-client';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LogOut,
  LayoutDashboard,
  Users,
  User as UserIcon,
  Menu,
  MessageSquare,
  Settings,
  UserCircle,
  BarChart3,
  Lightbulb,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useState } from 'react';

type NavItem = {
  title: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly: boolean;
};

function NavigationLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <nav className="flex flex-col gap-2 p-4">
      {items.map(item => (
        <Link
          key={item.href}
          href={item.href}
          onClick={onNavigate}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 ${
            pathname === item.href
              ? 'bg-indigo-500/10 text-indigo-400 font-medium'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
          }`}
        >
          <item.icon className="w-5 h-5" />
          {item.title}
        </Link>
      ))}
    </nav>
  );
}

export function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push('/admin/login');
    router.refresh();
  };

  const navItems: NavItem[] = [
    {
      title: 'Dashboard',
      href: '/dashboard',
      icon: LayoutDashboard,
      adminOnly: false,
    },
    {
      title: 'Messages',
      href: '/messages',
      icon: MessageSquare,
      adminOnly: false,
    },
    {
      title: 'Business Reports',
      href: '/business-reports',
      icon: BarChart3,
      adminOnly: false,
    },
    {
      title: 'Future Plans',
      href: '/future-plans',
      icon: Lightbulb,
      adminOnly: false,
    },
    {
      title: 'Customers',
      href: '/customers',
      icon: UserCircle,
      adminOnly: false,
    },
    {
      title: 'Settings',
      href: '/settings',
      icon: Settings,
      adminOnly: false,
    },
    {
      title: 'User Management',
      href: '/admin/users',
      icon: Users,
      adminOnly: true,
    },
  ];

  const filteredNavItems = navItems.filter(
    item => !item.adminOnly || session?.user?.role === 'admin'
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between p-4 border-b border-slate-800 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
            <LayoutDashboard className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white tracking-wide">Company</span>
        </div>
        <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
          <SheetTrigger
            render={
              <Button variant="ghost" size="icon" className="text-slate-400 hover:text-white" />
            }
          >
            <Menu className="w-6 h-6" />
          </SheetTrigger>
          <SheetContent side="left" className="bg-slate-900 border-none p-0 w-72">
            <div className="flex items-center gap-3 p-6 border-b border-slate-800">
              <div className="w-8 h-8 rounded-lg bg-indigo-500 flex items-center justify-center">
                <LayoutDashboard className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-white tracking-wide text-lg">Company</span>
            </div>
            <NavigationLinks
              items={filteredNavItems}
              pathname={pathname}
              onNavigate={() => setIsMobileMenuOpen(false)}
            />
          </SheetContent>
        </Sheet>
      </header>

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-72 bg-slate-900 border-r border-slate-800 min-h-screen sticky top-0">
        <div className="flex items-center gap-3 p-6 border-b border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <LayoutDashboard className="w-5 h-5 text-white" />
          </div>
          <span className="font-bold text-white tracking-wide text-xl">Company</span>
        </div>
        <div className="flex-1 overflow-y-auto mt-4 px-2">
          <NavigationLinks
            items={filteredNavItems}
            pathname={pathname}
            onNavigate={() => setIsMobileMenuOpen(false)}
          />
        </div>

        {/* User Profile Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/50">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 h-auto p-3 hover:bg-slate-800 rounded-xl transition-all"
                />
              }
            >
              <Avatar className="w-10 h-10 border border-slate-700 bg-slate-800">
                <AvatarImage src={session?.user?.image ?? ''} />
                <AvatarFallback className="bg-indigo-500/20 text-indigo-400 text-lg">
                  {session?.user?.name?.[0]?.toUpperCase() ?? 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start truncate text-left flex-1 min-w-0">
                <span className="font-medium text-slate-200 truncate w-full">
                  {session?.user?.name}
                </span>
                <span className="text-xs text-slate-500 truncate w-full flex items-center gap-1">
                  {session?.user?.role === 'admin' && (
                    <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"></span>
                  )}
                  {session?.user?.email}
                </span>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 bg-slate-900 border-slate-800 text-slate-200 pb-2 shadow-xl shadow-black/50 rounded-xl"
            >
              <DropdownMenuLabel className="p-4 bg-slate-800/50 rounded-t-xl mb-2">
                <p className="font-medium text-white">{session?.user?.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{session?.user?.email}</p>
                <div className="mt-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700">
                  Role:{' '}
                  <span
                    className={
                      session?.user?.role === 'admin'
                        ? 'text-indigo-400 ml-1 font-semibold'
                        : 'ml-1'
                    }
                  >
                    {session?.user?.role}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuItem className="px-4 py-2.5 mx-2 rounded-lg hover:bg-slate-800 cursor-pointer text-slate-300 transition-colors">
                <UserIcon className="w-4 h-4 mr-2" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-slate-800 my-2 mx-2" />
              <DropdownMenuItem
                className="text-red-400 focus:text-red-300 px-4 py-2.5 mx-2 rounded-lg hover:bg-red-500/10 cursor-pointer transition-colors"
                onClick={handleSignOut}
              >
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-x-hidden p-6 md:p-8">
        <div className="max-w-6xl mx-auto">{children}</div>
      </main>
    </div>
  );
}
