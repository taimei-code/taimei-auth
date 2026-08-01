import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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

// 破壊的操作の確認ダイアログ。open state の所有・実行中 disable・完了/失敗時に閉じる までを
// ここに閉じる。エラー文言の表示は呼び出し側の notice 領域 (dialog の外) が担う — Radix は
// 開いている dialog の背面を aria-hidden にするため、閉じる前に背面へ描画したエラーは利用者に
// 届かない。個別ダイアログごとに同じ穴が開いた (退会 / 事業所削除 / メンバー削除) ため一般化した。
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
  // resolve / reject いずれでも dialog は閉じる。失敗の通知は呼び出し側が自身の catch で
  // notice state に載せること (ここでは表示しない)。
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
