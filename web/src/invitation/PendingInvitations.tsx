import { useAtomValue } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { PendingInvitation } from "@core/invitation/invitation-contract";
import { roleLabelJa } from "@core/membership/role-label";

import { failedBeforeAnyValue, useWaitForValue } from "../shared/atom-runtime";
import { failureMessage } from "../shared/failure-message";
import { notifyAfterRefresh, notifyError } from "../shared/notify";
import { Button } from "../shared/ui/button";
import { Separator } from "../shared/ui/separator";
import { pendingInvitationsOf, useRevokeInvitation } from "./invitation-atom";

const REVOKE_FAILED = "招待の取り消しに失敗しました。";

const expiresAtFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

export const PendingInvitations = ({ companyId }: { companyId: string }) => {
  const invitationsAtom = pendingInvitationsOf(companyId);
  const result = useAtomValue(invitationsAtom);
  const waitForInvitations = useWaitForValue(invitationsAtom);
  const revokeInvitation = useRevokeInvitation();
  const [busyInvitationId, setBusyInvitationId] = useState<string | null>(null);

  const invitations = result.pipe(
    AsyncResult.map((list) => list.invitations),
    AsyncResult.getOrElse((): readonly PendingInvitation[] => []),
  );
  if (failedBeforeAnyValue(result)) {
    return (
      <>
        <Separator className="my-8" />
        <p role="alert" className="text-sm text-destructive">
          招待中の一覧を取得できませんでした。
        </p>
      </>
    );
  }
  if (invitations.length === 0) return null;

  const handleRevoke = (invitationId: string) => {
    if (busyInvitationId) return;
    setBusyInvitationId(invitationId);
    revokeInvitation(companyId, invitationId)
      .then(
        Exit.match({
          onSuccess: () =>
            notifyAfterRefresh(waitForInvitations, {
              done: "招待を取り消しました。",
              staleShort: "招待を取り消しました",
            }),
          onFailure: (cause) =>
            notifyError(
              failureMessage(
                cause,
                {
                  Forbidden: "招待を取り消す権限がありません。",
                  NotFoundOrNotPending: REVOKE_FAILED,
                  Unauthorized: REVOKE_FAILED,
                },
                REVOKE_FAILED,
              ),
            ),
        }),
      )
      .finally(() => setBusyInvitationId(null));
  };

  return (
    <>
      <Separator className="my-8" />
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
    </>
  );
};
