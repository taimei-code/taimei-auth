import { useState } from "react";
import { Loader2 } from "lucide-react";

import { roleLabelJa } from "@core/membership/role-label";

import { notifyAfterRefresh, notifyError } from "../shared/notify";
import { describeRequestJsonError } from "../shared/request-json";
import { Button } from "../shared/ui/button";
import { revokeInvitation, type PendingInvitation } from "./invitation-api";

type Props = {
  companyId: string;
  invitations: PendingInvitation[];
  onChanged: () => Promise<unknown>;
};

// オプションは toLocaleString("ja-JP") の既定と同値 — 表示を変えずに formatter を再利用する
const expiresAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

// 未受諾の招待一覧と取り消し。busy はメンバー行の操作と別キーで持つ (別セクションの実行中に塞がないため)。
export const PendingInvitations = ({ companyId, invitations, onChanged }: Props) => {
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

  const handleRevoke = (invitationId: string) => {
    if (busyInvitationId) return;
    setBusyInvitationId(invitationId);
    revokeInvitation(companyId, invitationId)
      .then(() =>
        notifyAfterRefresh(onChanged, {
          done: "招待を取り消しました。",
          staleShort: "招待を取り消しました",
        }),
      )
      .catch((err) => {
        notifyError(
          describeRequestJsonError(err, {
            403: "招待を取り消す権限がありません。",
            fallback: "招待の取り消しに失敗しました。",
          }),
        );
      })
      .finally(() => setBusyInvitationId(null));
  };

  return (
    <section aria-label="招待中" className="space-y-2">
      <h2 className="text-sm font-medium text-foreground">招待中</h2>
      {invitations.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between gap-3 rounded-md border border-dashed border-border px-4 py-3 text-sm"
        >
          <div className="min-w-0">
            <p title={inv.email} className="truncate font-medium text-foreground">
              {inv.email}
            </p>
            <p className="text-xs text-muted-foreground">
              {roleLabelJa(inv.role)} / 期限 {expiresAtFormatter.format(new Date(inv.expires_at))}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {busyInvitationId === inv.id && (
              <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={busyInvitationId !== null}
              onClick={() => handleRevoke(inv.id)}
            >
              取消
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
};
