import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { listMembers, transferOwnership, type Member } from "@/lib/account-api";
import { authClient } from "@/lib/auth-client";
import { memberLabel } from "@/lib/labels";
import { notifyAfterRefresh } from "@/components/notify";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  companyId: string;
  companyName: string;
  onTransferred: () => Promise<unknown>;
  trigger: React.ReactNode;
};

// 唯一の OWNER が事業所から抜ける前に、別メンバーへオーナーを委譲する modal。
// 自分以外のメンバーを一覧し、選択 → transfer-ownership 実行。
export const TransferOwnershipModal = ({
  companyId,
  companyName,
  onTransferred,
  trigger,
}: Props) => {
  const [open, setOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selfId = authClient.useSession().data?.user.id ?? null;

  useEffect(() => {
    // selfId 未確定 (session fetch 中) で開くと自分自身が委譲対象に混ざるため、確定まで待つ。
    if (!open || !selfId) return;
    setLoading(true);
    setError(null);
    listMembers(companyId)
      .then((m) => setMembers(m.filter((x) => x.user_id !== selfId)))
      .catch(() => setError("メンバーの取得に失敗しました。"))
      .finally(() => setLoading(false));
  }, [open, companyId, selfId]);

  const handleTransfer = (to: Member) => {
    if (busyUserId) return;
    setBusyUserId(to.user_id);
    setError(null);
    transferOwnership(companyId, to.user_id)
      .then(() => {
        setOpen(false);
        return notifyAfterRefresh(onTransferred, {
          done: `${memberLabel(to)} にオーナーを委譲しました。`,
          staleShort: "オーナーを委譲しました",
        });
      })
      .catch(() => setError("オーナー委譲に失敗しました。"))
      .finally(() => setBusyUserId(null));
  };

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
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">
            委譲できるメンバーがいません。先にメンバーを招待してください。
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.membership_id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{memberLabel(m)}</span>
                <Button size="sm" onClick={() => handleTransfer(m)} disabled={busyUserId !== null}>
                  {busyUserId === m.user_id ? <Loader2 className="size-4 animate-spin" /> : null}
                  委譲
                </Button>
              </div>
            ))}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </DialogContent>
    </Dialog>
  );
};
