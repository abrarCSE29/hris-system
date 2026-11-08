import { Building2, ClipboardCheck, LayoutDashboard, LayoutTemplate, LifeBuoy, ListChecks, UserRoundCheck, Users, type LucideIcon } from "lucide-react";
import type { Role } from "./types";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Omitted = every signed-in user. Display only; the backend enforces access. */
  roles?: Role[];
  /** Only show to people who currently have an active onboarding checklist. */
  newHireOnly?: boolean;
}

// Items are added here as their pages are built (People, Onboarding, … in later tasks).
export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard, roles: ["HR_ADMIN"] },
  { href: "/requests", label: "Requests", icon: LifeBuoy },
  { href: "/people", label: "People", icon: Users, roles: ["MANAGER", "HR_ADMIN"] },
  { href: "/departments", label: "Departments", icon: Building2, roles: ["HR_ADMIN"] },
  { href: "/onboarding", label: "Onboarding", icon: ClipboardCheck, roles: ["MANAGER", "HR_ADMIN"] },
  { href: "/onboarding/me", label: "My onboarding", icon: UserRoundCheck, newHireOnly: true },
  { href: "/onboarding/tasks", label: "Task queue", icon: ListChecks },
  { href: "/onboarding/templates", label: "Templates", icon: LayoutTemplate, roles: ["HR_ADMIN"] },
];

export const navForRole = (role: Role, { isNewHire = false }: { isNewHire?: boolean } = {}) =>
  NAV_ITEMS.filter((i) => (!i.roles || i.roles.includes(role)) && (!i.newHireOnly || isNewHire));

/** The nav item for the current page: the longest matching href, so "/onboarding" isn't also lit on "/onboarding/tasks". */
export function activeHref(items: NavItem[], pathname: string): string | undefined {
  return items
    .map((i) => i.href)
    .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
    .sort((a, b) => b.length - a.length)[0];
}

export const homeForRole = (role: Role) => (role === "HR_ADMIN" ? "/dashboard" : "/requests");
