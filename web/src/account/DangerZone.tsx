import { useState } from "react";
import { Trash2 } from "lucide-react";

import { authClient } from "../auth/auth-client";
import { redirectAfterAuthChange } from "../auth/auth-redirect";
import { ConfirmDestructiveDialog } from "../shared/ConfirmDestructiveDialog";
import { Button } from "../shared/ui/button";

// Magic Link / OAuth ユーザーは password を持たず better-auth 側で session ごと完全削除されるため、再認証 step は挟まない
export const DangerZone = () => {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const deleteAccount = async () => {
    setErrorMessage(null);
    const { error } = await authClient.deleteUser({});
    if (error) {
      // toast にせず inline 固定: role=alert の即時読み上げを保ち、e2e も alert role を契約にしている
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
