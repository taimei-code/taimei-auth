import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { AccountApiError, addCompany } from "@/lib/account-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Props = {
  // 作成成功後に呼ぶ。呼び出し側で company state を refresh する想定
  // (サーバが last_used を新事業所へ更新済みなので refresh だけで「現在の事業所」が切り替わる)。
  onCreated: () => void | Promise<void>;
  trigger: ReactNode;
};

// 既存 user が新しい事業所を追加するダイアログ。入力項目は SignUpCompany と同じ 2 つ
// (事業所名 + 事業形態)。既定は法人 (追加作成は法人が主のため signup の個人事業主とは別既定)。
// 作成後は新事業所が現在の事業所になる。
export const AddCompanyDialog = ({ onCreated, trigger }: Props) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState<"PERSONAL" | "CORPORATE">("CORPORATE");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setOrgCode("CORPORATE");
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (submitting) return; // 送信中は閉じない (二重 submit / state 不整合を防ぐ)
    if (!next) reset();
    setOpen(next);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    addCompany({ name: name.trim(), org_code: orgCode })
      .then(async () => {
        await onCreated();
        reset();
        setOpen(false);
      })
      .catch((err) => {
        setError(err instanceof AccountApiError ? err.message : "事業所の作成に失敗しました。");
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>事業所を追加</DialogTitle>
          <DialogDescription>
            新しい事業所を作成します。作成後は自動でこの事業所に切り替わり、あなたがオーナーになります。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" aria-label="事業所追加フォーム">
          <div className="space-y-2">
            <Label htmlFor="add-company-name">事業所名</Label>
            <Input
              id="add-company-name"
              type="text"
              required
              placeholder="例: 株式会社サンプル / 山田太郎"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              法人なら正式社名、個人事業主なら屋号 (なければご自身のお名前)
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">事業形態</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="add-org-code"
                value="CORPORATE"
                checked={orgCode === "CORPORATE"}
                onChange={() => setOrgCode("CORPORATE")}
                disabled={submitting}
              />
              法人
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="add-org-code"
                value="PERSONAL"
                checked={orgCode === "PERSONAL"}
                onChange={() => setOrgCode("PERSONAL")}
                disabled={submitting}
              />
              個人事業主
            </label>
          </fieldset>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={submitting || name.trim() === ""}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              作成する
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
