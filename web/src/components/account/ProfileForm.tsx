import { type FormEvent, useState } from "react";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
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
  const [status, setStatus] = useState<{ kind: "error" | "saved"; text: string } | null>(null);

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    const { error } = await authClient.updateUser({ name });
    setSubmitting(false);
    setStatus(
      error
        ? { kind: "error", text: error.message ?? "保存に失敗しました" }
        : { kind: "saved", text: "保存しました" },
    );
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
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "text-sm",
            status?.kind === "error" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {status?.text ?? ""}
        </p>
      </div>
    </form>
  );
};
