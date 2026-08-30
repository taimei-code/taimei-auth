import { useState, type ReactNode } from "react";
import { Loader2, ShieldOff } from "lucide-react";

import { notifyAfterRefresh } from "../shared/notify";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog";
import { disableMfa } from "./mfa-api";
import { useMfaCodeEntry } from "./use-mfa-code-entry";

const CODE_INPUT_ID = "mfa-disable-code";

type Props = {
  onDisabled: () => Promise<unknown>;
  trigger: ReactNode;
};

// ConfirmDestructiveDialog を使わない — あちらは onConfirm の成否によらず閉じる契約で、コードの
// 打ち間違いでも閉じて入力をやり直させることになる。見た目と busy 中の扱いは揃え、閉じる条件だけ変える。
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
