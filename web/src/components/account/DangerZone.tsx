import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { redirectAfterAuthChange } from "@/lib/auth-redirect";
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

// Magic Link / OAuth ユーザーは password を持たず better-auth 側で session ごと完全削除されるため、再認証 step は挟まない
export const DangerZone = () => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deleteAccount = async () => {
    setDeleting(true);
    setErrorMessage(null);
    const { error } = await authClient.deleteUser({});
    if (error) {
      setDeleting(false);
      // エラー文言は dialog の背面 (本セクション内) に描画され、Radix が背面を aria-hidden に
      // するため dialog を開いたままだと利用者に届かない。先に閉じてから表示する。
      setDialogOpen(false);
      setErrorMessage(error.message ?? "退会処理に失敗しました");
      return;
    }
    redirectAfterAuthChange("deleteAccount");
  };

  return (
    <section className="rounded-md border border-destructive/40">
      <header className="border-b border-destructive/40 bg-destructive/10 px-6 py-4">
        <h2 className="font-semibold text-destructive">危険な操作</h2>
      </header>
      <div className="flex items-center justify-between gap-4 p-6">
        <div>
          <p className="font-medium">アカウントを削除</p>
          <p className="mt-1 text-sm text-muted-foreground">
            すべてのデータが削除され、復元できません。
          </p>
          {errorMessage ? (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {errorMessage}
            </p>
          ) : null}
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 className="size-4" aria-hidden="true" />
              退会する
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>退会の確認</DialogTitle>
              <DialogDescription>
                本当にアカウントを削除しますか? この操作は取り消せません。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">キャンセル</Button>
              </DialogClose>
              <Button variant="destructive" onClick={deleteAccount} disabled={deleting}>
                {deleting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
                退会を確定する
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  );
};
