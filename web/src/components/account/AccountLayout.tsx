import { Outlet, NavLink } from "react-router-dom";
import { User, ShieldCheck, Monitor, Plug, Users, Building2, Settings2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { CompanyProvider } from "@/lib/company-context";
import { SignOutButton } from "@/components/account/SignOutButton";
import { CompanySwitcher } from "@/components/account/CompanySwitcher";

// 事業所セクション (CompanySwitcher + 所属事業所 / メンバー) と アカウントセクションの 2 区分。
// mobile 対応 (Sheet 等) は未実装で、現時点は固定 sidebar の最小構成。
const companyNav = [
  { to: "/account/companies", icon: Building2, label: "所属事業所", end: false },
  { to: "/account/members", icon: Users, label: "メンバー", end: false },
  { to: "/account/company-settings", icon: Settings2, label: "事業所設定", end: false },
] as const;

const accountNav = [
  { to: "/account", icon: User, label: "プロフィール", end: true },
  { to: "/account/security", icon: ShieldCheck, label: "セキュリティ", end: false },
  { to: "/account/sessions", icon: Monitor, label: "セッション", end: false },
  { to: "/account/connections", icon: Plug, label: "連携アカウント", end: false },
] as const;

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
    isActive
      ? "bg-accent text-accent-foreground"
      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
  );

export const AccountLayout = () => {
  return (
    <CompanyProvider>
      <div className="flex min-h-svh bg-background">
        <aside className="flex w-60 flex-col gap-1 border-r p-4">
          <CompanySwitcher />

          <div className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            事業所
          </div>
          {companyNav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
              <item.icon className="size-4" aria-hidden="true" />
              {item.label}
            </NavLink>
          ))}

          <div className="mb-1 mt-3 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            アカウント
          </div>
          {accountNav.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={navLinkClass}>
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
    </CompanyProvider>
  );
};
