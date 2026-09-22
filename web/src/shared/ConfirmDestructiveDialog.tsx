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
  onConfirm: () => Promise<unknown>;
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
    if (busy) return; // 実行中は閉じない (二重実行と state の不整合を防ぐ)
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
