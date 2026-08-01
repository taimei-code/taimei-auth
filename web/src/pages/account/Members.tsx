import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  createInvitation,
  describeAccountApiError,
  listInvitations,
  listMembers,
  removeMember,
  revokeInvitation,
  updateMemberRole,
  type CompanyRole,
  type Member,
  type PendingInvitation,
} from "@/lib/account-api";
import { useCompanyContext } from "@/lib/company-context";
import { authClient } from "@/lib/auth-client";
import { roleLabelJa } from "@/lib/role-label";
import { ConfirmActionDialog } from "@/components/ConfirmActionDialog";
import { Notice, type NoticeValue } from "@/components/Notice";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Members = () => {
  const { currentMembership, loading: companyLoading } = useCompanyContext();
  const selfUserId = authClient.useSession().data?.user.id ?? null;
  const companyId = currentMembership?.company_id ?? null;
  const canManage = currentMembership?.role === "OWNER" || currentMembership?.role === "ADMIN";
  const isOwner = currentMembership?.role === "OWNER";

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [notice, setNotice] = useState<NoticeValue | null>(null);

  const refresh = useCallback((cid: string) => {
    return Promise.all([listMembers(cid), listInvitations(cid).catch(() => [])]).then(
      ([m, inv]) => {
        setMembers(m);
        setInvitations(inv);
      },
    );
  }, []);

  useEffect(() => {
    if (!companyId) {
      if (!companyLoading) setLoading(false);
      return;
    }
    setLoading(true);
    refresh(companyId)
      .catch((e) => console.error("failed to load members", e))
      .finally(() => setLoading(false));
  }, [companyId, companyLoading, refresh]);

  const handleInvite = (e: FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    setNotice(null);
    createInvitation(companyId, { email: inviteEmail.trim(), role: inviteRole })
      .then((res) => {
        setInviteEmail("");
        setNotice({
          kind: "success",
          text: res.reused ? "既存の招待を再送しました" : "招待を送信しました",
        });
        return refresh(companyId);
      })
      .catch((err) => {
        setNotice({
          kind: "error",
          text: describeAccountApiError(err, {
            429: "招待の送信回数が上限に達しました。時間をおいて再試行してください。",
            403: "招待する権限がありません。",
            fallback: "招待の送信に失敗しました。",
          }),
        });
      })
      .finally(() => setSubmitting(false));
  };

  const handleRoleChange = (targetUserId: string, role: CompanyRole) => {
    if (!companyId || busyUserId) return;
    setBusyUserId(targetUserId);
    setNotice(null);
    updateMemberRole(companyId, targetUserId, role)
      .then(() => refresh(companyId))
      .catch((err) => {
        setNotice({
          kind: "error",
          text: describeAccountApiError(err, {
            409: "最後のオーナーを降格することはできません。",
            403: "この役割変更を行う権限がありません。",
            fallback: "役割の変更に失敗しました。",
          }),
        });
      })
      .finally(() => setBusyUserId(null));
  };

  // ConfirmActionDialog の onConfirm 契約: promise を返し、失敗の通知はここで notice に載せる。
  const handleRemove = (targetUserId: string): Promise<void> => {
    if (!companyId || busyUserId) return Promise.resolve();
    setBusyUserId(targetUserId);
    setNotice(null);
    return removeMember(companyId, targetUserId)
      .then(({ accountDeleted }) =>
        refresh(companyId).then(() =>
          setNotice({
            kind: "success",
            text: accountDeleted
              ? "メンバーを削除しました。他に所属が無いためアカウントも削除されました。"
              : "メンバーを削除しました。",
          }),
        ),
      )
      .catch((err) => {
        setNotice({
          kind: "error",
          text: describeAccountApiError(err, {
            409: "最後のオーナーは削除できません。",
            fallback: "メンバーの削除に失敗しました。",
          }),
        });
      })
      .finally(() => setBusyUserId(null));
  };

  if (companyLoading || loading) {
    return (
      <div className="flex min-h-[40svh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!companyId) {
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
        {members.map((m) => {
          const isSelf = m.user_id === selfUserId;
          // OWNER のみが OWNER を操作可能。自分自身の役割は変更させない (誤操作防止)。
          const canEditRole = canManage && !isSelf && (isOwner || m.role !== "OWNER");
          return (
            <div
              key={m.membership_id}
              className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {m.user_name || m.user_email}
                  {isSelf && <span className="ml-2 text-xs text-muted-foreground">(自分)</span>}
                </p>
                <p className="truncate text-xs text-muted-foreground">{m.user_email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {canEditRole ? (
                  <select
                    aria-label={`${m.user_email} の役割`}
                    value={m.role}
                    disabled={busyUserId !== null}
                    onChange={(e) => handleRoleChange(m.user_id, e.target.value as CompanyRole)}
                    className="h-8 rounded-md border border-input bg-transparent px-2 text-xs"
                  >
                    <option value="MEMBER">メンバー</option>
                    <option value="ADMIN">管理者</option>
                    {/* OWNER 昇格は OWNER のみ。ADMIN には選択肢を出さない */}
                    {isOwner && <option value="OWNER">オーナー</option>}
                  </select>
                ) : (
                  <span className="text-xs font-medium text-muted-foreground">
                    {roleLabelJa(m.role)}
                  </span>
                )}
                {canManage && !isSelf && (
                  <ConfirmActionDialog
                    trigger={
                      <Button variant="ghost" size="sm" disabled={busyUserId !== null}>
                        削除
                      </Button>
                    }
                    title="メンバーの削除"
                    description={`${m.user_name || m.user_email} をこの事業所から削除します。このメンバーが他の事業所に所属していない場合、アカウントごと削除されます。`}
                    confirmLabel="削除する"
                    onConfirm={() => handleRemove(m.user_id)}
                  />
                )}
              </div>
            </div>
          );
        })}
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
                  {isOwner && <option value="OWNER">オーナー</option>}
                </select>
              </div>
              <Button type="submit" disabled={submitting || inviteEmail.trim() === ""}>
                {submitting ? <Loader2 className="animate-spin" /> : null}
                招待する
              </Button>
            </form>
            <Notice value={notice} />
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
                      onClick={() => {
                        revokeInvitation(companyId, inv.id)
                          .then(() => refresh(companyId))
                          .catch((e) => console.error("revoke failed", e));
                      }}
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
