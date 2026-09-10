"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Activity, Users, LifeBuoy, Library, Workflow, ListChecks, ScrollText,
} from "lucide-react";

/* Icons are picked by name here so the server layout can pass plain data. */
const ICONS = {
  overview: LayoutDashboard,
  usage: Activity,
  accounts: Users,
  tickets: LifeBuoy,
  library: Library,
  pipeline: Workflow,
  standards: ListChecks,
  audit: ScrollText,
} as const;

export type NavIcon = keyof typeof ICONS;
export type NavItem = { href: string; label: string; icon: NavIcon; count?: number };
export type NavGroup = { label: string; items: NavItem[] };

export function AdminNav({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname() ?? "";
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname.startsWith(href));
  return (
    <nav className="ad-nav" aria-label="Admin">
      {groups.map((g) => (
        <div key={g.label} className="ad-group">
          <div className="ad-group-label">{g.label}</div>
          {g.items.map((n) => {
            const Icon = ICONS[n.icon];
            const active = isActive(n.href);
            return (
              <Link key={n.href} href={n.href} className={`ad-navlink${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined}>
                <Icon aria-hidden="true" />
                <span>{n.label}</span>
                {(n.count ?? 0) > 0 && <span className="ad-badge">{n.count}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
