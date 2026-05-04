import { Outlet, NavLink } from "react-router-dom";
import { ChevronLeft, User, ShieldCheck, Monitor, Plug } from "lucide-react";

import { cn } from "@/lib/utils";

// アカウント管理画面の共通 Layout: 左 Sidebar nav + 右 Outlet (各ページ)。
// 「taimei に戻る」リンクは固定先 (https://app.taimei-code.com/): cross-origin の Referrer は
// strict-origin-when-cross-origin policy でデフォルト消えるため referrer ベースは動かず、
// ?return_to= クエリでの動的化は将来の multi-product 化時に対応する。
const TAIMEI_HOME_URL = "https://app.taimei-code.com/";

const navItems = [
  { to: "/account", icon: User, label: "プロフィール", end: true },
  { to: "/account/security", icon: ShieldCheck, label: "セキュリティ", end: false },
  { to: "/account/sessions", icon: Monitor, label: "セッション", end: false },
  { to: "/account/connections", icon: Plug, label: "連携アカウント", end: false },
] as const;

export const AccountLayout = () => {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="w-64 border-r p-4 flex flex-col gap-1">
        <a
          href={TAIMEI_HOME_URL}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          <ChevronLeft className="size-4" />
          taimei に戻る
        </a>

        <div className="mt-4 mb-2 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
      </aside>

      <main className="flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-3xl">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
