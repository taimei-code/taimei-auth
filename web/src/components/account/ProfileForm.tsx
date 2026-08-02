import { type FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { Notice, type NoticeValue } from "@/components/Notice";
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
  const [status, setStatus] = useState<NoticeValue | null>(null);

  const saveProfile = (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    authClient
      .updateUser({ name })
      .then(({ error }) =>
        setStatus(
          error
            ? { kind: "error", text: error.message ?? "保存に失敗しました" }
            : { kind: "success", text: "保存しました" },
        ),
      )
      .catch(() => setStatus({ kind: "error", text: "保存に失敗しました" }))
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

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {submitting ? "保存中…" : "保存"}
        </Button>
        <Notice value={status} />
      </div>
    </form>
  );
};
