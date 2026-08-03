import { type FormEvent, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  deleteCompany,
  describeAccountApiError,
  updateCompany,
  type OrgCode,
} from "@/lib/account-api";
import { redirectAfterAuthChange } from "@/lib/auth-redirect";
import { useCompanyContext } from "@/lib/company-context";
import { ConfirmDestructiveDialog } from "@/components/ConfirmDestructiveDialog";
import { notifyError, notifySuccess } from "@/components/notify";
import { OrgCodeField } from "@/components/account/OrgCodeField";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// 事業所設定 (OWNER のみ)。name / org_code 編集 + 事業所削除。
export const CompanySettings = () => {
  const { currentMembership, memberships, loading, refresh } = useCompanyContext();
  const isOwner = currentMembership?.role === "OWNER";
  const companyId = currentMembership?.company_id ?? null;
  // 最後の所属事業所を削除すると actor 自身が orphan として連動削除される (ADR-0010 D3)。
  const isLastCompany = memberships.length <= 1;

  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState<OrgCode>("PERSONAL");
  const [submitting, setSubmitting] = useState(false);

  // form 初期値の流し込みは「対象 company が変わった時のみ」。company_id を依存にすることで、
  // 保存後の refresh で currentMembership 参照が差し替わっても編集中の入力を上書きしない。
  const currentCompanyId = currentMembership?.company_id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: company 切替時のみ prefill する意図
  useEffect(() => {
    if (currentMembership) {
      setName(currentMembership.company_name);
      setOrgCode(currentMembership.company_org_code === "CORPORATE" ? "CORPORATE" : "PERSONAL");
    }
  }, [currentCompanyId]);

  if (loading) {
    return (
      <div className="flex min-h-[40svh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!companyId || !isOwner) {
    return (
      <p className="text-sm text-muted-foreground">事業所設定の編集はオーナーのみ可能です。</p>
    );
  }

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    updateCompany(companyId, { name: name.trim(), org_code: orgCode })
      .then(() => refresh())
      .then(() => notifySuccess("事業所情報を更新しました。"))
      .catch((err) => {
        notifyError(
          describeAccountApiError(err, {
            403: "編集する権限がありません。",
            fallback: "更新に失敗しました。",
          }),
        );
      })
      .finally(() => setSubmitting(false));
  };

  // 削除成功で即 redirect する (context の再 fetch は遷移先マウント時に走るため refresh を待たない。
  // refresh の瞬断で redirect が不達になり「削除済なのにエラー表示」になるのを防ぐ)。
  // 最後の事業所削除では actor 自身が連動削除されるため、その時はログアウト先へ遷移する (ADR-0010 D3)。
  const handleDelete = () =>
    deleteCompany(companyId)
      .then(({ accountDeleted }) => {
        if (accountDeleted) {
          redirectAfterAuthChange("deleteAccount");
        } else {
          window.location.replace("/account/companies");
        }
      })
      .catch((err) => {
        notifyError(
          describeAccountApiError(err, {
            403: "削除する権限がありません。",
            fallback: "事業所の削除に失敗しました。",
          }),
        );
      });

  return (
    <div>
      <div>
        <h1 className="text-xl font-semibold tracking-tight">事業所設定</h1>
        <p className="mt-1 text-sm text-muted-foreground">事業所名と事業形態の編集</p>
      </div>
      <Separator className="my-6" />

      <form onSubmit={handleSave} className="max-w-md space-y-4">
        <div className="space-y-2">
          <Label htmlFor="company-name">事業所名</Label>
          <Input
            id="company-name"
            type="text"
            required
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            disabled={submitting}
          />
        </div>
        <OrgCodeField value={orgCode} onChange={setOrgCode} disabled={submitting} name="org_code" />
        <Button type="submit" disabled={submitting || name.trim() === ""}>
          {submitting ? <Loader2 className="animate-spin" /> : null}
          保存
        </Button>
      </form>

      <Separator className="my-10" />

      <section className="rounded-md border border-destructive/40">
        <header className="border-b border-destructive/40 bg-destructive/10 px-6 py-4">
          <h2 className="font-semibold text-destructive">事業所を削除</h2>
        </header>
        <div className="flex items-center justify-between gap-4 p-6">
          <p className="text-sm text-muted-foreground">
            削除すると、この事業所はメンバーの一覧から外れます。
          </p>
          <ConfirmDestructiveDialog
            trigger={
              <Button variant="destructive" disabled={submitting}>
                削除する
              </Button>
            }
            title="事業所削除の確認"
            description={`「${currentMembership?.company_name}」を削除します。この操作は元に戻せません。`}
            confirmLabel="削除する"
            onConfirm={handleDelete}
          >
            {isLastCompany && (
              <p className="text-sm font-medium text-destructive">
                これは最後の所属事業所です。削除するとアカウントも閉じられ、ログアウトされます。
              </p>
            )}
          </ConfirmDestructiveDialog>
        </div>
      </section>
    </div>
  );
};
