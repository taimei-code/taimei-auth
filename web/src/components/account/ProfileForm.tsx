import { type FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { notifyError, notifySuccess } from "@/components/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  initialName: string;
  email: string;
};

export const ProfileForm = ({ initialName, email }: Props) => {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    authClient
      .updateUser({ name })
      .then(({ error }) =>
        error
          ? notifyError(error.message ?? "保存に失敗しました。")
          : notifySuccess("保存しました。"),
      )
      .catch(() => notifyError("保存に失敗しました。"))
      .finally(() => setSubmitting(false));
  };

  return (
    <form onSubmit={saveProfile} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="email">メールアドレス</Label>
        <Input id="email" type="email" autoComplete="email" value={email} disabled />
      </div>

      <div className="space-y-2">
        <Label htmlFor="name">名前</Label>
        <Input
          id="name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
          disabled={submitting}
          aria-describedby="name-help"
        />
        <p id="name-help" className="text-xs text-muted-foreground">
          アプリケーション内で表示される名前です
        </p>
      </div>

      <Button type="submit" disabled={submitting}>
        {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {submitting ? "保存中…" : "保存"}
      </Button>
    </form>
  );
};
