import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

import { notifyAfterRefresh } from "../shared/notify";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog";
import { OrgCodeField } from "./OrgCodeField";
import { addCompany, type OrgCode } from "./company-api";

type Props = {
  // 作成成功後に呼ぶ (server が last_used を更新済みなので refresh だけで「現在の事業所」が切り替わる)。
  onCreated: () => Promise<unknown>;
  trigger: ReactNode;
};

// 既存 user が新しい事業所を追加するダイアログ。入力は SignUpCompany と同じ 2 つで、既定は法人
// (追加作成は法人が主のため signup の個人事業主とは別既定)。作成後は新事業所が現在の事業所になる。
export const AddCompanyDialog = ({ onCreated, trigger }: Props) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState<OrgCode>("CORPORATE");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setOrgCode("CORPORATE");
    setErrorMessage(null);
  };

  // 送信中は閉じない。server 側に作成の dedupe が無いため submitting 解除は chain 全体の finally に置く
  // (成功枝に移すと閉じてから再取得が終わるまでの間に再送信でき、事業所が 2 つできる)
  const handleOpenChange = (next: boolean) => {
    if (submitting) return;
    if (!next) reset();
    setOpen(next);
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    setSubmitting(true);
    setErrorMessage(null);
    addCompany({ name: trimmedName, org_code: orgCode })
      .then(() => {
        reset();
        setOpen(false);
        return notifyAfterRefresh(onCreated, {
          done: `「${trimmedName}」を作成し、現在の事業所に切り替えました。`,
          staleShort: "事業所を作成しました",
        });
      })
      // dialog 内 inline は作成 POST 自体の失敗だけを受け持つ (再取得の失敗は上で通知済み)
      .catch(() => setErrorMessage("事業所の作成に失敗しました。"))
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
          <OrgCodeField
            value={orgCode}
            onChange={setOrgCode}
            disabled={submitting}
            name="add-org-code"
            order={["CORPORATE", "PERSONAL"]}
          />
          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
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
