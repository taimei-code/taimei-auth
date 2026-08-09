import { useState, type ReactNode } from "react";
import { Loader2, ShieldOff } from "lucide-react";

import { disableMfa } from "@/lib/mfa-api";
import { useMfaCodeEntry } from "@/lib/use-mfa-code-entry";
import { notifyAfterRefresh } from "@/components/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const CODE_INPUT_ID = "mfa-disable-code";

type Props = {
  // 無効化の完了後に呼ぶ (セキュリティページの状態再取得)。
  onDisabled: () => Promise<unknown>;
  trigger: ReactNode;
};

// 破壊的操作の確認ダイアログだが ConfirmDestructiveDialog は使わない — あちらは onConfirm の
// 成否によらず閉じる契約で、コードの打ち間違いでも閉じてしまい入力をやり直させることになる。
// 見た目と busy 中の扱いは同じ慣習に合わせ、閉じる条件だけを変えている。
export const MfaDisableDialog = ({ onDisabled, trigger }: Props) => {
  const [open, setOpen] = useState(false);

  const entry = useMfaCodeEntry({
    inputId: CODE_INPUT_ID,
    submit: (input) =>
      disableMfa(input).then(() => {
        setOpen(false);
        return notifyAfterRefresh(onDisabled, {
          done: "多要素認証 (MFA) を無効にしました。",
          staleShort: "多要素認証 (MFA) を無効にしました",
        });
      }),
  });

  const handleOpenChange = (next: boolean) => {
    if (entry.submitting) return;
    if (!next) entry.reset();
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>多要素認証 (MFA) を無効にする</DialogTitle>
          <DialogDescription>
            無効にすると、ログイン時の確認コードの入力が不要になります。本人確認のため、現在の確認コードまたはリカバリーコードを入力してください。
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={entry.handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={CODE_INPUT_ID}>{entry.labelText}</Label>
            <Input {...entry.inputProps} />
            <p id={entry.hintId} className="text-xs text-muted-foreground">
              {entry.hint}
            </p>
          </div>

          <button
            type="button"
            onClick={entry.toggleKind}
            disabled={entry.submitting}
            className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {entry.toggleLabel}
          </button>

          {entry.errorMessage && (
            <p id={entry.errorId} role="alert" className="text-sm text-destructive">
              {entry.errorMessage}
            </p>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={entry.submitting}>
                キャンセル
              </Button>
            </DialogClose>
            <Button type="submit" variant="destructive" disabled={!entry.canSubmit}>
              {entry.submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <ShieldOff className="size-4" aria-hidden="true" />
              )}
              無効にする
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
