import { useAtomValue } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode, useState } from "react";
import { Loader2 } from "lucide-react";

import type { Member } from "@core/membership/membership-contract";
import type { Role } from "@core/membership/policy";
import { roleLabelJa } from "@core/membership/role-label";

import { useSelfUserId } from "../auth/auth-client";
import { LoadingRow } from "../shared/AsyncSection";
import { failedBeforeAnyValue, useWaitForValue } from "../shared/atom-runtime";
import { ConfirmDestructiveDialog } from "../shared/ConfirmDestructiveDialog";
import { failureMessage } from "../shared/failure-message";
import { notifyAfterRefresh, notifyError } from "../shared/notify";
import { Button } from "../shared/ui/button";
import { NativeSelect } from "../shared/ui/native-select";
import { memberLabel } from "./member-label";
import { membersOf, useChangeRole, useRemoveMember } from "./membership-atom";

const ROLE_CHANGE_FAILED = "役割の変更に失敗しました。";
const REMOVAL_FAILED = "メンバーの削除に失敗しました。";

type Props = {
  companyId: string;
  canManage: boolean;
  assignableRoles: readonly Role[];
};

export const MemberList = ({ companyId, canManage, assignableRoles }: Props) => {
  const selfUserId = useSelfUserId();
  const membersAtom = membersOf(companyId);
  const result = useAtomValue(membersAtom);
  const waitForMembers = useWaitForValue(membersAtom);
  const changeRole = useChangeRole();
  const removeMember = useRemoveMember();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  if (AsyncResult.isInitial(result)) return <LoadingRow />;

  const members = result.pipe(
    AsyncResult.map((list) => list.members),
    AsyncResult.getOrElse((): readonly Member[] => []),
  );

  const handleRoleChange = (target: Member, role: Role) => {
    if (busyUserId) return;
    setBusyUserId(target.user_id);
    changeRole(companyId, target.user_id, role)
      .then(
        Exit.match({
          onSuccess: () =>
            notifyAfterRefresh(waitForMembers, {
              done: `${memberLabel(target)} の役割を${roleLabelJa(role)}に変更しました。`,
              staleShort: "役割を変更しました",
            }),
          onFailure: (cause) =>
            notifyError(
              failureMessage(
                cause,
                {
                  LastOwner: "最後のオーナーを降格することはできません。",
                  Forbidden: "この役割変更を行う権限がありません。",
                  NotFound: ROLE_CHANGE_FAILED,
                },
                ROLE_CHANGE_FAILED,
              ),
            ),
        }),
      )
      .finally(() => setBusyUserId(null));
  };

  const handleRemove = (targetUserId: string): Promise<void> => {
    if (busyUserId) return Promise.resolve();
    setBusyUserId(targetUserId);
    return removeMember(companyId, targetUserId)
      .then(
        Exit.match({
          onSuccess: ({ account_deleted }) =>
            notifyAfterRefresh(waitForMembers, {
              done: account_deleted
                ? "メンバーを削除しました。他に所属が無いためアカウントも削除されました。"
                : "メンバーを削除しました。",
              staleShort: account_deleted
                ? "メンバーとアカウントを削除しました"
                : "メンバーを削除しました",
            }),
          onFailure: (cause) =>
            notifyError(
              failureMessage(
                cause,
                {
                  LastOwner: "最後のオーナーは削除できません。",
                  Forbidden: REMOVAL_FAILED,
                  NotFound: REMOVAL_FAILED,
                },
                REMOVAL_FAILED,
              ),
            ),
        }),
      )
      .finally(() => setBusyUserId(null));
  };

  return (
    <section aria-label="メンバー一覧">
      {failedBeforeAnyValue(result) && (
        <p role="alert" className="text-sm text-destructive">
          メンバーの一覧を取得できませんでした。
        </p>
      )}
      <ul className="space-y-2">
        {members.map((member) => (
          <MemberRow
            key={member.membership_id}
            member={member}
            isSelf={member.user_id === selfUserId}
            busy={busyUserId === member.user_id}
          >
            {canManage && member.user_id !== selfUserId && assignableRoles.includes(member.role) ? (
              <MemberOperations
                member={member}
                busy={busyUserId !== null}
                assignableRoles={assignableRoles}
                onRoleChange={(role) => handleRoleChange(member, role)}
                onRemove={() => handleRemove(member.user_id)}
              />
            ) : (
              <span className="text-xs font-medium text-muted-foreground">
                {roleLabelJa(member.role)}
              </span>
            )}
          </MemberRow>
        ))}
      </ul>
    </section>
  );
};

type MemberRowProps = {
  member: Member;
  isSelf: boolean;
  busy: boolean;
  children: ReactNode;
};

const MemberRow = ({ member, isSelf, busy, children }: MemberRowProps) => (
  <li className="flex items-center justify-between gap-3 rounded-md border border-border px-4 py-3 text-sm">
    <div className="min-w-0">
      <p className="truncate font-medium text-foreground">
        {memberLabel(member)}
        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(自分)</span>}
      </p>
      <p className="truncate text-xs text-muted-foreground">{member.user_email}</p>
    </div>
    <div className="flex shrink-0 items-center gap-2">
      {busy && <Loader2 aria-hidden className="size-4 animate-spin text-muted-foreground" />}
      {children}
    </div>
  </li>
);

type MemberOperationsProps = {
  member: Member;
  busy: boolean;
  assignableRoles: readonly Role[];
  onRoleChange: (role: Role) => void;
  onRemove: () => Promise<void>;
};

const MemberOperations = ({
  member,
  busy,
  assignableRoles,
  onRoleChange,
  onRemove,
}: MemberOperationsProps) => (
  <>
    <NativeSelect
      aria-label={`${member.user_email} の役割`}
      value={member.role}
      disabled={busy}
      onChange={(e) => {
        const next = assignableRoles.find((role) => role === e.target.value);
        if (next) onRoleChange(next);
      }}
      className="h-9 w-28 text-sm"
    >
      {assignableRoles.map((role) => (
        <option key={role} value={role}>
          {roleLabelJa(role)}
        </option>
      ))}
    </NativeSelect>
    <ConfirmDestructiveDialog
      trigger={
        <Button variant="ghost" size="sm" disabled={busy}>
          削除
        </Button>
      }
      title="メンバーの削除"
      description={`${memberLabel(member)} をこの事業所から削除します。このメンバーが他の事業所に所属していない場合、アカウントごと削除されます。`}
      confirmLabel="削除する"
      onConfirm={onRemove}
    />
  </>
);
