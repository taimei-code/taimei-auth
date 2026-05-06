import { Outlet, NavLink } from "react-router-dom";
import { User, ShieldCheck, Monitor, Plug, LogOut } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

// アカウント管理画面の共通 Layout: 左 Sidebar nav + 右 Outlet (各ページ)。
const navItems = [
  { to: "/account", icon: User, label: "プロフィール", end: true },
  { to: "/account/security", icon: ShieldCheck, label: "セキュリティ", end: false },
  { to: "/account/sessions", icon: Monitor, label: "セッション", end: false },
  { to: "/account/connections", icon: Plug, label: "連携アカウント", end: false },
] as const;

export const AccountLayout = () => {
  // signOut 後に window.location で / に飛ばす理由: react-router 内 navigate だと
  // SessionGuard が再 mount されない可能性があり、stale な session 状態で /account を出してしまうため。
  const handleSignOut = async () => {
    await authClient.signOut();
    window.location.href = "/";
  };

  return (
    <div className="flex min-h-svh bg-background">
      <aside className="flex w-64 flex-col gap-1 border-r p-4">
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
            <item.icon className="size-4" />
            {item.label}
          </NavLink>
        ))}

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-auto flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <LogOut className="size-4" />
          ログアウト
        </button>
      </aside>

      <main className="flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-3xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
