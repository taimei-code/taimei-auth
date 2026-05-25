import { Outlet, NavLink } from "react-router-dom";
import { User, ShieldCheck, Monitor, Plug, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/account/SignOutButton";

// メンバー管理は ADR-009 で追加。事業所切替 (CompanySwitcher) / section 分割は Phase C。
const navItems = [
  { to: "/account", icon: User, label: "プロフィール", end: true },
  { to: "/account/members", icon: Users, label: "メンバー", end: false },
  { to: "/account/security", icon: ShieldCheck, label: "セキュリティ", end: false },
  { to: "/account/sessions", icon: Monitor, label: "セッション", end: false },
  { to: "/account/connections", icon: Plug, label: "連携アカウント", end: false },
] as const;

export const AccountLayout = () => {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="flex w-60 flex-col gap-1 border-r p-4">
        <div className="mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          アカウント
        </div>

        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )
            }
          >
            <item.icon className="size-4" aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}

        <div className="mt-auto border-t pt-3">
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-2xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
