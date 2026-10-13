import { useAtomValue } from "@effect/atom-react";
import { Exit } from "effect";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import type { Member } from "@core/membership/membership-contract";

import { useSelfUserId } from "../auth/auth-client";
import { companyStateAtom } from "../account/account-atom";
import { failedBeforeAnyValue, useWaitForValue } from "../shared/atom-runtime";
import { notifyAfterRefresh } from "../shared/notify";
import { Button } from "../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog";
import { memberLabel } from "./member-label";
import { membersOf, useTransferOwnership } from "./membership-atom";

type Props = {
  companyId: string;
  companyName: string;
  onTransferred: () => void;
  trigger: React.ReactNode;
};

export const TransferOwnershipModal = ({
  companyId,
  companyName,
  onTransferred,
  trigger,
}: Props) => {
  const [open, setOpen] = useState(false);
  const waitForCompanyState = useWaitForValue(companyStateAtom);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>オーナーを委譲</DialogTitle>
          <DialogDescription>
            「{companyName}」のオーナーを別のメンバーに委譲します。あなたは管理者になります。
          </DialogDescription>
        </DialogHeader>
        <TransferCandidates
          companyId={companyId}
          onTransferred={(to) => {
            setOpen(false);
            onTransferred();
            return notifyAfterRefresh(waitForCompanyState, {
              done: `${memberLabel(to)} にオーナーを委譲しました。`,
              staleShort: "オーナーを委譲しました",
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
};

type TransferCandidatesProps = {
  companyId: string;
  onTransferred: (to: Member) => Promise<void>;
};

const TransferCandidates = ({ companyId, onTransferred }: TransferCandidatesProps) => {
  const selfUserId = useSelfUserId();
  const result = useAtomValue(membersOf(companyId));

  const cannotExcludeSelfYet = selfUserId === null;
  if (AsyncResult.isInitial(result) || cannotExcludeSelfYet) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (failedBeforeAnyValue(result)) {
    return <p className="text-sm text-destructive">メンバーの取得に失敗しました。</p>;
  }

  const candidates = result.pipe(
    AsyncResult.map((list) => list.members.filter((member) => member.user_id !== selfUserId)),
    AsyncResult.getOrElse((): readonly Member[] => []),
  );
  return (
    <TransferPicker companyId={companyId} candidates={candidates} onTransferred={onTransferred} />
  );
};

const TransferPicker = ({
  companyId,
  candidates,
  onTransferred,
}: TransferCandidatesProps & { candidates: readonly Member[] }) => {
  const transferOwnership = useTransferOwnership();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [transferFailed, setTransferFailed] = useState(false);

  const handleTransfer = (to: Member) => {
    if (busyUserId) return;
    setBusyUserId(to.user_id);
    setTransferFailed(false);
    transferOwnership(companyId, to.user_id)
      .then(
        Exit.match({
          onSuccess: () => onTransferred(to),
          onFailure: () => setTransferFailed(true),
        }),
      )
      .finally(() => setBusyUserId(null));
  };

  return (
    <>
      <CandidateList candidates={candidates} busyUserId={busyUserId} onTransfer={handleTransfer} />
      {transferFailed && <p className="text-sm text-destructive">オーナー委譲に失敗しました。</p>}
    </>
  );
};

type CandidateListProps = {
  candidates: readonly Member[];
  busyUserId: string | null;
  onTransfer: (to: Member) => void;
};

const CandidateList = ({ candidates, busyUserId, onTransfer }: CandidateListProps) =>
  candidates.length === 0 ? (
    <p className="py-4 text-sm text-muted-foreground">
      委譲できるメンバーがいません。先にメンバーを招待してください。
    </p>
  ) : (
    <div className="space-y-2">
      {candidates.map((m) => (
        <div
          key={m.membership_id}
          className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
        >
          <span>{memberLabel(m)}</span>
          <Button size="sm" onClick={() => onTransfer(m)} disabled={busyUserId !== null}>
            {busyUserId === m.user_id ? <Loader2 className="size-4 animate-spin" /> : null}
            委譲
          </Button>
        </div>
      ))}
    </div>
  );
