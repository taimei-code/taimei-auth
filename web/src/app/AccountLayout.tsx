import { Link, Outlet } from "@tanstack/react-router";
import { User, ShieldCheck, Monitor, Plug, Users, Building2, Settings2 } from "lucide-react";

import { SignOutButton } from "../auth/SignOutButton";
import { CompanySwitcher } from "../company/CompanySwitcher";
import { Toaster } from "../shared/notify";

const companyNav = [
  { to: "/account/companies", icon: Building2, label: "所属事業所" },
  { to: "/account/members", icon: Users, label: "メンバー" },
  { to: "/account/company-settings", icon: Settings2, label: "事業所設定" },
] as const;

const accountNav = [
  { to: "/account", icon: User, label: "プロフィール" },
  { to: "/account/security", icon: ShieldCheck, label: "セキュリティ" },
  { to: "/account/sessions", icon: Monitor, label: "セッション" },
  { to: "/account/connections", icon: Plug, label: "連携アカウント" },
] as const;

const navLinkClass =
  "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground data-[status=active]:bg-accent data-[status=active]:text-accent-foreground";

const NavLinks = ({ items }: { items: typeof companyNav | typeof accountNav }) =>
  items.map((item) => (
    <Link
      key={item.to}
      to={item.to}
      activeOptions={{ exact: item.to === "/account" }}
      className={navLinkClass}
    >
      <item.icon className="size-4" aria-hidden="true" />
      {item.label}
    </Link>
  ));

export const AccountLayout = () => {
  return (
    <div className="flex min-h-svh bg-background">
      <aside className="flex w-60 flex-col gap-1 border-r p-4">
        <CompanySwitcher />

        <div className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          事業所
        </div>
        <NavLinks items={companyNav} />

        <div className="mb-1 mt-3 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          アカウント
        </div>
        <NavLinks items={accountNav} />

        <div className="mt-auto border-t pt-3">
          <SignOutButton />
        </div>
      </aside>

      <main className="flex-1 p-6 md:p-10">
        <div className="mx-auto max-w-2xl">
          <Outlet />
        </div>
      </main>

      <Toaster />
    </div>
  );
};
