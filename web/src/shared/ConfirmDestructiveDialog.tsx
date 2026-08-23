import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";

// 破壊的操作の確認ダイアログ。open state の所有・実行中 disable・完了/失敗時に閉じる までを
// ここに閉じる。結果の通知は呼び出し側が dialog の外で行う (背面 aria-hidden 下の読み上げ制約を
// 含む通知経路の規則は shared/notify.tsx のコメントが正本)。
export const ConfirmDestructiveDialog = ({
  trigger,
  title,
  description,
  confirmLabel,
  confirmIcon,
  onConfirm,
  children,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmIcon?: ReactNode;
  // resolve / reject いずれでも dialog は閉じる。失敗の通知は呼び出し側が自身の catch で出す
  onConfirm: () => Promise<unknown>;
  // description 下に挟む追加の警告等
  children?: ReactNode;
}) => {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleConfirm = () => {
    setBusy(true);
    onConfirm()
      .catch((e) => console.error("confirm action failed", e))
      .finally(() => {
        setBusy(false);
        setOpen(false);
      });
  };

  const handleOpenChange = (next: boolean) => {
    if (busy) return; // 実行中は閉じない (二重実行 / state 不整合を防ぐ)
    setOpen(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              キャンセル
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleConfirm} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : confirmIcon}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
