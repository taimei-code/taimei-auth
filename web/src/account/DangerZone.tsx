import { Exit } from "effect";
import { useState } from "react";
import { Trash2 } from "lucide-react";

import { signOut } from "../auth/sign-out";
import { ConfirmDestructiveDialog } from "../shared/ConfirmDestructiveDialog";
import { failureMessage } from "../shared/failure-message";
import { leaveSpaAfterAccountDeleted } from "../shared/leave-spa";
import { Button } from "../shared/ui/button";
import { useDeleteAccount } from "./account-atom";

const DELETE_FAILED = "退会処理に失敗しました";

export const DangerZone = () => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const requestDeletion = useDeleteAccount();

  const deleteAccount = async () => {
    setErrorMessage(null);
    const exit = await requestDeletion();
    if (Exit.isFailure(exit)) {
      setErrorMessage(
        failureMessage(
          exit.cause,
          {
            LastOwner: "所有者として残っている事業所があります。先に委譲または削除してください。",
            NotFound: DELETE_FAILED,
          },
          DELETE_FAILED,
        ),
      );
      return;
    }
    await signOut();
    leaveSpaAfterAccountDeleted();
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
        <ConfirmDestructiveDialog
          trigger={
            <Button variant="destructive">
              <Trash2 className="size-4" aria-hidden="true" />
              退会する
            </Button>
          }
          title="退会の確認"
          description="本当にアカウントを削除しますか? この操作は取り消せません。"
          confirmLabel="退会を確定する"
          onConfirm={deleteAccount}
        />
      </div>
    </section>
  );
};
