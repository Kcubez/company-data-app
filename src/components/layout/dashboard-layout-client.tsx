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
  Clock,
  Wrench,
  TrendingUp,
  Database,
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
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import { Separator } from '@/components/ui/separator';
import { ThemeToggle } from '@/components/theme-toggle';
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
    <nav className="flex flex-col gap-0.5 p-3" aria-label="Primary">
      {items.map(item => {
        const isActive =
          pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href));
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={isActive ? 'page' : undefined}
            className={`group/nav relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors duration-200 cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 ${
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
            }`}
          >
            {isActive && (
              <span
                aria-hidden
                className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-r-full bg-primary"
              />
            )}
            <Icon
              className={`h-4 w-4 shrink-0 transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground group-hover/nav:text-foreground'
              }`}
              aria-hidden
            />
            <span className="truncate">{item.title}</span>
          </Link>
        );
      })}
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
    { title: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, adminOnly: false },
    { title: 'Demand Sheets', href: '/demand-sheets', icon: BarChart3, adminOnly: false },
    { title: 'Project Expiries', href: '/project-expiries', icon: Clock, adminOnly: false },
    { title: 'Website Updates', href: '/website-updates', icon: Wrench, adminOnly: false },
    { title: 'Business Reports', href: '/business-reports', icon: TrendingUp, adminOnly: false },
    { title: 'Customers', href: '/customers', icon: UserCircle, adminOnly: false },
    { title: 'Messages', href: '/messages', icon: MessageSquare, adminOnly: false },
    { title: 'Settings', href: '/settings', icon: Settings, adminOnly: false },
    { title: 'User Management', href: '/admin/users', icon: Users, adminOnly: true },
  ];

  const filteredNavItems = navItems.filter(
    item => !item.adminOnly || session?.user?.role === 'admin',
  );

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      {/* Mobile Header */}
      <header className="md:hidden flex items-center justify-between gap-2 px-4 h-14 border-b border-border bg-sidebar/80 backdrop-blur-xl sticky top-0 z-40">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            <Database className="w-4 h-4" aria-hidden />
          </div>
          <span className="font-heading font-bold text-base truncate">
            {process.env.NEXT_PUBLIC_APP_NAME ?? 'Company Data'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Open navigation"
                  className="cursor-pointer"
                />
              }
            >
              <Menu className="w-5 h-5" aria-hidden />
            </SheetTrigger>
            <SheetContent
              side="left"
              className="bg-sidebar text-sidebar-foreground border-r border-sidebar-border p-0 w-72"
            >
              <SheetTitle className="sr-only">Primary navigation</SheetTitle>
              <div className="flex items-center gap-2.5 px-5 h-14 border-b border-sidebar-border">
                <div className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
                  <Database className="w-4 h-4" aria-hidden />
                </div>
                <span className="font-heading font-bold truncate">
                  {process.env.NEXT_PUBLIC_APP_NAME ?? 'Company Data'}
                </span>
              </div>
              <NavigationLinks
                items={filteredNavItems}
                pathname={pathname}
                onNavigate={() => setIsMobileMenuOpen(false)}
              />
            </SheetContent>
          </Sheet>
        </div>
      </header>

      {/* Desktop Sidebar */}
      <aside
        className="hidden md:flex flex-col w-64 bg-sidebar text-sidebar-foreground border-r border-sidebar-border min-h-screen sticky top-0"
        aria-label="Primary"
      >
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shadow-sm">
            <Database className="w-5 h-5" aria-hidden />
          </div>
          <span className="font-heading font-bold text-base  truncate">
            {process.env.NEXT_PUBLIC_APP_NAME ?? 'Company Data'}
          </span>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          <NavigationLinks
            items={filteredNavItems}
            pathname={pathname}
            onNavigate={() => setIsMobileMenuOpen(false)}
          />
        </div>

        <div className="p-3 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  className="w-full justify-start gap-3 h-auto p-2.5 hover:bg-sidebar-accent rounded-lg cursor-pointer"
                />
              }
            >
              <Avatar className="h-9 w-9 bg-muted text-muted-foreground">
                <AvatarImage src={session?.user?.image ?? ''} alt={session?.user?.name ?? ''} />
                <AvatarFallback className="bg-primary/15 text-primary text-sm font-semibold">
                  {session?.user?.name?.[0]?.toUpperCase() ?? 'U'}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start truncate text-left flex-1 min-w-0">
                <span className="font-medium text-sm text-foreground truncate w-full">
                  {session?.user?.name}
                </span>
                <span className="text-[11px] text-muted-foreground truncate w-full">
                  {session?.user?.email}
                </span>
              </div>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              side="top"
              className="w-60 mb-1"
            >
              <DropdownMenuLabel className="font-normal">
                <p className="text-sm font-semibold text-foreground">{session?.user?.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                  {session?.user?.email}
                </p>
                <div className="mt-2 inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                  Role:{' '}
                  <span
                    className={
                      session?.user?.role === 'admin'
                        ? 'text-primary font-semibold'
                        : 'text-foreground'
                    }
                  >
                    {session?.user?.role}
                  </span>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer">
                <UserIcon className="w-4 h-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer">
                <Settings className="w-4 h-4" />
                Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={handleSignOut}
                className="cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Separator className="my-2" />

          <div className="flex items-center justify-between px-1">
            <span className="text-[10px] uppercase  text-muted-foreground font-semibold">
              Theme
            </span>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main
        id="main-content"
        className="flex-1 min-w-0 overflow-x-hidden p-4 sm:p-6 md:p-8 bg-background"
        tabIndex={-1}
      >
        <div className="max-w-6xl mx-auto page-transition">{children}</div>
      </main>
    </div>
  );
}
