import { Exit } from "effect";
import { type FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";

import type { Role } from "@core/membership/policy";
import { roleLabelJa } from "@core/membership/role-label";

import { useWaitForValue } from "../shared/atom-runtime";
import { failureMessage } from "../shared/failure-message";
import { notifyAfterRefresh, notifyError } from "../shared/notify";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import { NativeSelect } from "../shared/ui/native-select";
import { pendingInvitationsOf, useCreateInvitation } from "./invitation-atom";
import { parseRedirectTarget, type RedirectTargetSearch } from "./redirect-target";

const INVITE_FAILED = "招待の送信に失敗しました。";

type Props = {
  companyId: string;
  assignableRoles: readonly Role[];
  redirectSearch: RedirectTargetSearch;
};

export const InviteMemberForm = ({ companyId, assignableRoles, redirectSearch }: Props) => {
  const waitForInvitations = useWaitForValue(pendingInvitationsOf(companyId));
  const createInvitation = useCreateInvitation();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");
  const effectiveInviteRole = assignableRoles.includes(inviteRole) ? inviteRole : "MEMBER";
  const [submitting, setSubmitting] = useState(false);

  const handleInvite = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    createInvitation(companyId, {
      email: inviteEmail.trim(),
      role: effectiveInviteRole,
      redirect_target: parseRedirectTarget(redirectSearch),
    })
      .then(
        Exit.match({
          onSuccess: ({ reused }) => {
            setInviteEmail("");
            return notifyAfterRefresh(waitForInvitations, {
              done: reused ? "既存の招待を再送しました。" : "招待を送信しました。",
              staleShort: reused ? "既存の招待を再送しました" : "招待を送信しました",
            });
          },
          onFailure: (cause) =>
            notifyError(
              failureMessage(
                cause,
                {
                  RateLimited: "招待の送信回数が上限に達しました。時間をおいて再試行してください。",
                  Forbidden: "招待する権限がありません。",
                  Unauthorized: INVITE_FAILED,
                },
                INVITE_FAILED,
              ),
            ),
        }),
      )
      .finally(() => setSubmitting(false));
  };

  return (
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
            value={effectiveInviteRole}
            onChange={(e) => {
              const next = assignableRoles.find((role) => role === e.target.value);
              if (next) setInviteRole(next);
            }}
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
  );
};
