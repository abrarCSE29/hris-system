"use client";

import { LogOut } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { ChatHead } from "@/components/chat/chat-head";
import { Skeleton } from "@/components/ui/skeleton";
import { useLogout, useMe } from "@/lib/hooks/auth";
import { activeHref, navForRole } from "@/lib/nav";

/**
 * Navigation items sit flush against the sidebar's left edge with square left corners. The selected item alone
 * gets a red bar on that edge. It keeps the same font weight as the other items: the stock sidebar makes the
 * selected item `font-medium`, which made its text look like a different font and nudged its width.
 */
const ITEM_CLASS =
  "relative rounded-l-none data-active:font-normal data-active:before:absolute data-active:before:inset-y-0 data-active:before:left-0 data-active:before:w-1 data-active:before:bg-primary";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const logout = useLogout();
  const pathname = usePathname();

  // On 401 the api client is already redirecting to /login; show a skeleton meanwhile.
  if (!me.data) {
    return (
      <div className="min-h-screen p-8">
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const { user } = me.data;
  const items = navForRole(user.role.code, { isNewHire: me.data.isNewHire });
  const current = activeHref(items, pathname);

  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarHeader>
          <div className="px-2 py-1 text-lg font-semibold tracking-tight">
            HRIS<span className="text-primary">.</span>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="py-2 pr-2 pl-0">
            <SidebarGroupContent>
              <SidebarMenu aria-label="Main">
                {items.map(({ href, label, icon: Icon }) => (
                  <SidebarMenuItem key={href}>
                    <SidebarMenuButton
                      isActive={href === current}
                      aria-current={href === current ? "page" : undefined}
                      className={ITEM_CLASS}
                      render={<Link href={href} />}
                    >
                      <Icon />
                      <span>{label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <div className="min-w-0 px-2">
            <div className="truncate text-sm font-medium">{user.fullName}</div>
            <div className="truncate text-xs text-sidebar-foreground/70">
              {user.role.name} · {user.department.name}
            </div>
          </div>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={() => logout.mutate()}>
                <LogOut />
                <span>Sign out</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset>
        {/* The sidebar becomes a drawer on small screens; this bar holds its button. */}
        <header className="flex h-12 items-center gap-2 border-b px-4 md:hidden">
          <SidebarTrigger />
          <span className="font-semibold tracking-tight">HRIS</span>
        </header>
        <main className="min-w-0 p-4 md:p-8">{children}</main>
      </SidebarInset>
      <ChatHead firstName={user.fullName.split(" ")[0]} />
    </SidebarProvider>
  );
}
