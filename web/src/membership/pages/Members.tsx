import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { isAtLeast, requiresOwnerProtection, type Role } from "@core/membership/policy";
import { roleLabelJa } from "@core/membership/role-label";

import { useCurrentCompany } from "../../account/current-company";
import { authClient } from "../../auth/auth-client";
import { PendingInvitations } from "../../invitation/PendingInvitations";
import {
  createInvitation,
  listInvitations,
  type PendingInvitation,
} from "../../invitation/invitation-api";
import { ConfirmDestructiveDialog } from "../../shared/ConfirmDestructiveDialog";
import { notifyAfterRefresh, notifyError } from "../../shared/notify";
import { describeRequestJsonError } from "../../shared/request-json";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { NativeSelect } from "../../shared/ui/native-select";
import { Separator } from "../../shared/ui/separator";
import { memberLabel } from "../member-label";
import { listMembers, removeMember, updateMemberRole, type Member } from "../membership-api";

export const Members = () => {
  const { currentMembership, loading: companyLoading } = useCurrentCompany();
  const selfUserId = authClient.useSession().data?.user.id ?? null;
  const companyId = currentMembership?.company_id ?? null;
  const canManage = isAtLeast(currentMembership?.role ?? "", "ADMIN");
  const isOwner = currentMembership?.role === "OWNER";
  // OWNER 昇格の選択肢は OWNER のみに出す。ADMIN には出さない
  const assignableRoles: readonly Role[] = isOwner
    ? ["MEMBER", "ADMIN", "OWNER"]
    : ["MEMBER", "ADMIN"];

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [loading, setLoading] = useState(true);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");
  const [submitting, setSubmitting] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  // 2 つの一覧は個別に反映する (片方が転んでも取得済みの側は捨てない)。招待一覧は
  // ADMIN 未満だと server が 403 を返すため、権限が無ければ最初から叩かない
  const refresh = useCallback(() => {
    if (!companyId) return Promise.resolve();
    return Promise.all([
      listMembers(companyId).then(setMembers),
      (canManage ? listInvitations(companyId) : Promise.resolve([])).then(setInvitations),
    ]);
  }, [companyId, canManage]);

  useEffect(() => {
    if (!companyId) {
      if (!companyLoading) setLoading(false);
      return;
    }
    setLoading(true);
    // 取得失敗時に前の事業所の行が残ると別事業所の一覧に混ざる (残留行への操作は誤 POST) ため先に空にする
    setMembers([]);
    setInvitations([]);
    refresh()
      .catch((e) => console.error("failed to load members", e))
      .finally(() => setLoading(false));
  }, [companyId, companyLoading, refresh]);

  const handleInvite = (e: FormEvent) => {
    e.preventDefault();
    if (!companyId) return;
    setSubmitting(true);
    createInvitation(companyId, { email: inviteEmail.trim(), role: inviteRole })
      .then((res) => {
        setInviteEmail("");
        return notifyAfterRefresh(refresh, {
          done: res.reused ? "既存の招待を再送しました。" : "招待を送信しました。",
          staleShort: res.reused ? "既存の招待を再送しました" : "招待を送信しました",
        });
      })
      .catch((err) => {
        notifyError(
          describeRequestJsonError(err, {
            429: "招待の送信回数が上限に達しました。時間をおいて再試行してください。",
            403: "招待する権限がありません。",
            fallback: "招待の送信に失敗しました。",
          }),
        );
      })
      .finally(() => setSubmitting(false));
  };

  const handleRoleChange = (target: Member, role: Role) => {
    if (!companyId || busyUserId) return;
    const targetLabel = memberLabel(target);
    setBusyUserId(target.user_id);
    updateMemberRole(companyId, target.user_id, role)
      .then(() =>
        notifyAfterRefresh(refresh, {
          done: `${targetLabel} の役割を${roleLabelJa(role)}に変更しました。`,
          staleShort: "役割を変更しました",
        }),
      )
      .catch((err) => {
        notifyError(
          describeRequestJsonError(err, {
            409: "最後のオーナーを降格することはできません。",
            403: "この役割変更を行う権限がありません。",
            fallback: "役割の変更に失敗しました。",
          }),
        );
      })
      .finally(() => setBusyUserId(null));
  };

  // ConfirmDestructiveDialog の onConfirm 契約: promise を返し、失敗の通知はここ (呼び出し側) が出す。
  const handleRemove = (targetUserId: string): Promise<void> => {
    if (!companyId || busyUserId) return Promise.resolve();
    setBusyUserId(targetUserId);
    return removeMember(companyId, targetUserId)
      .then(({ accountDeleted }) =>
        notifyAfterRefresh(refresh, {
          done: accountDeleted
            ? "メンバーを削除しました。他に所属が無いためアカウントも削除されました。"
            : "メンバーを削除しました。",
          staleShort: accountDeleted
            ? "メンバーとアカウントを削除しました"
            : "メンバーを削除しました",
        }),
      )
      .catch((err) => {
        notifyError(
          describeRequestJsonError(err, {
            409: "最後のオーナーは削除できません。",
            fallback: "メンバーの削除に失敗しました。",
          }),
        );
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

      <section aria-label="メンバー一覧">
        <ul className="space-y-2">
          {members.map((m) => {
            const isSelf = m.user_id === selfUserId;
            // 自分自身は操作 (役割変更・削除) の対象に出さない (誤操作防止)
            const canOperateThisMember =
              canManage && !isSelf && (isOwner || !requiresOwnerProtection(m.role));
            return (
              <li
                key={m.membership_id}
                className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {memberLabel(m)}
                    {isSelf && <span className="ml-2 text-xs text-muted-foreground">(自分)</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{m.user_email}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {busyUserId === m.user_id && (
                    <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />
                  )}
                  {canOperateThisMember ? (
                    <NativeSelect
                      aria-label={`${m.user_email} の役割`}
                      value={m.role}
                      disabled={busyUserId !== null}
                      onChange={(e) => handleRoleChange(m, e.target.value as Role)}
                      className="h-9 w-28 text-sm"
                    >
                      {assignableRoles.map((role) => (
                        <option key={role} value={role}>
                          {roleLabelJa(role)}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">
                      {roleLabelJa(m.role)}
                    </span>
                  )}
                  {canOperateThisMember && (
                    <ConfirmDestructiveDialog
                      trigger={
                        <Button variant="ghost" size="sm" disabled={busyUserId !== null}>
                          削除
                        </Button>
                      }
                      title="メンバーの削除"
                      description={`${memberLabel(m)} をこの事業所から削除します。このメンバーが他の事業所に所属していない場合、アカウントごと削除されます。`}
                      confirmLabel="削除する"
                      onConfirm={() => handleRemove(m.user_id)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
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
                <NativeSelect
                  id="invite-role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as Role)}
                  disabled={submitting}
                  className="sm:w-36"
                >
                  {assignableRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabelJa(role)}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <Button type="submit" disabled={submitting || inviteEmail.trim() === ""}>
                {submitting ? <Loader2 className="animate-spin" /> : null}
                招待する
              </Button>
            </form>
          </section>

          {invitations.length > 0 && (
            <>
              <Separator className="my-8" />
              <PendingInvitations
                companyId={companyId}
                invitations={invitations}
                onChanged={refresh}
              />
            </>
          )}
        </>
      )}
    </div>
  );
};
