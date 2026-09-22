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
  // server が作成時に last_used を更新しているため、refresh だけで現在の事業所が切り替わる
  onCreated: () => Promise<unknown>;
  trigger: ReactNode;
};

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

  // server は作成の重複を除かないため、成功時に submitting を解除すると再送信で事業所が 2 つできる
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
