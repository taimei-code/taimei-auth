import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  AccountApiError,
  createInvitation,
  listInvitations,
  listMembers,
  listMyMemberships,
  revokeInvitation,
  type CompanyRole,
  type Member,
  type PendingInvitation,
} from "@/lib/account-api";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type LoadState = "loading" | "ready" | "no-company" | "forbidden";

const roleLabelJa = (role: string): string =>
  role === "OWNER" ? "オーナー" : role === "ADMIN" ? "管理者" : "メンバー";

export const Members = () => {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(
    (cid: string) =>
      Promise.all([listMembers(cid), listInvitations(cid).catch(() => [])]).then(([m, inv]) => {
        setMembers(m);
        setInvitations(inv);
      }),
    [],
  );

  useEffect(() => {
    listMyMemberships()
      .then((memberships) => {
        const current = memberships.at(0);
        if (!current) {
          setState("no-company");
          return null;
        }
        setCompanyId(current.company_id);
        setCanManage(current.role === "OWNER" || current.role === "ADMIN");
        return refresh(current.company_id).then(() => setState("ready"));
      })
      .catch((e) => {
        // 取得失敗時に "ready" にすると companyId=null のまま form が表示され、送信が silent 失敗する。
        // no-company 表示に倒して操作不能であることを明示する。
        console.error("failed to load members", e);
        setState("no-company");
      });
  }, [refresh]);

  const handleInvite = (e: FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    setMessage(null);
    createInvitation(companyId, { email: inviteEmail.trim(), role: inviteRole })
      .then((res) => {
        setInviteEmail("");
        setMessage(res.reused ? "既存の招待を再送しました" : "招待を送信しました");
        return refresh(companyId);
      })
      .catch((err) => {
        if (err instanceof AccountApiError && err.status === 429) {
          setMessage("招待の送信回数が上限に達しました。時間をおいて再試行してください。");
        } else if (err instanceof AccountApiError && err.status === 403) {
          setMessage("招待する権限がありません。");
        } else {
          setMessage("招待の送信に失敗しました。");
        }
      })
      .finally(() => setSubmitting(false));
  };

  const handleRevoke = (invitationId: string) => {
    if (!companyId || revokingId) return;
    setRevokingId(invitationId);
    revokeInvitation(companyId, invitationId)
      .then(() => refresh(companyId))
      .catch((e) => console.error("revoke failed", e))
      .finally(() => setRevokingId(null));
  };

  if (state === "loading") {
    return (
      <div className="flex min-h-[40svh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (state === "no-company") {
    return <p className="text-sm text-muted-foreground">事業所が見つかりません。</p>;
  }

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">メンバー</h1>
        <p className="mt-1 text-sm text-muted-foreground">事業所のメンバー一覧と招待</p>
      </div>
      <Separator className="my-6" />

      <section aria-label="メンバー一覧" className="space-y-2">
        {members.map((m) => (
          <div
            key={m.membership_id}
            className="flex items-center justify-between rounded-md border border-border px-4 py-3 text-sm"
          >
            <div>
              <p className="font-medium text-foreground">{m.user_name || m.user_email}</p>
              <p className="text-xs text-muted-foreground">{m.user_email}</p>
            </div>
            <span className="text-xs font-medium text-muted-foreground">{roleLabelJa(m.role)}</span>
          </div>
        ))}
      </section>

      {canManage && (
        <>
          <Separator className="my-8" />
          <section aria-label="メンバーを招待" className="space-y-4">
            <h2 className="text-sm font-medium text-foreground">メンバーを招待</h2>
            <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1 space-y-2">
                <Label htmlFor="invite-email">メールアドレス</Label>
                <Input
                  id="invite-email"
                  type="email"
                  required
                  placeholder="member@example.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-role">役割</Label>
                <select
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as CompanyRole)}
                  disabled={submitting}
                  className="h-9 rounded-md border border-input bg-transparent px-3 text-sm"
                >
                  <option value="MEMBER">メンバー</option>
                  <option value="ADMIN">管理者</option>
                  <option value="OWNER">オーナー</option>
                </select>
              </div>
              <Button type="submit" disabled={submitting || inviteEmail.trim() === ""}>
                {submitting ? <Loader2 className="animate-spin" /> : null}
                招待する
              </Button>
            </form>
            {message && <p className="text-sm text-muted-foreground">{message}</p>}
          </section>

          {invitations.length > 0 && (
            <>
              <Separator className="my-8" />
              <section aria-label="招待中" className="space-y-2">
                <h2 className="text-sm font-medium text-foreground">招待中</h2>
                {invitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between rounded-md border border-dashed border-border px-4 py-3 text-sm"
                  >
                    <div>
                      <p className="font-medium text-foreground">{inv.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {roleLabelJa(inv.role)} / 期限{" "}
                        {new Date(inv.expires_at).toLocaleString("ja-JP")}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleRevoke(inv.id)}
                      disabled={revokingId !== null}
                    >
                      取消
                    </Button>
                  </div>
                ))}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
};
