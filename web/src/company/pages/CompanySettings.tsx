import { type FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { useCurrentCompany } from "../../account/current-company";
import { redirectAfterAuthChange } from "../../auth/auth-redirect";
import { ConfirmDestructiveDialog } from "../../shared/ConfirmDestructiveDialog";
import { notifyAfterRefresh, notifyError } from "../../shared/notify";
import { describeRequestJsonError } from "../../shared/request-json";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { Separator } from "../../shared/ui/separator";
import { OrgCodeField } from "../OrgCodeField";
import { deleteCompany, updateCompany, type OrgCode } from "../company-api";

// 事業所設定 (OWNER のみ)。name / org_code 編集 + 事業所削除。
export const CompanySettings = () => {
  const { currentMembership, memberships, loading, refresh } = useCurrentCompany();
  const isOwner = currentMembership?.role === "OWNER";
  // 最後の所属事業所を削除すると actor 自身が orphan として連動削除される (ADR-0010 D3)。
  const isLastCompany = memberships.length <= 1;

  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState<OrgCode>("PERSONAL");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

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

  if (!currentMembership || !isOwner) {
    return (
      <p className="text-sm text-muted-foreground">事業所設定の編集はオーナーのみ可能です。</p>
    );
  }

  const companyId = currentMembership.company_id;
  const companyName = currentMembership.company_name;

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    updateCompany(companyId, { name: name.trim(), org_code: orgCode })
      .then(() =>
        notifyAfterRefresh(refresh, {
          done: "事業所情報を更新しました。",
          staleShort: "事業所情報を更新しました",
        }),
      )
      .catch((err) => {
        notifyError(
          describeRequestJsonError(err, {
            403: "編集する権限がありません。",
            fallback: "更新に失敗しました。",
          }),
        );
      })
      .finally(() => setSubmitting(false));
  };

  // 削除後は一覧へ SPA 遷移してから notifyAfterRefresh で通知する (Companies の handleLeave と同じ形)。
  // 遷移を refresh の成否に依存させず「削除済なのにエラー表示」を防ぐ (失敗は「表示が古い」文言で吸収)。
  // 通知と refresh が遷移後も生きるのは Toaster (AccountLayout) と CurrentCompanyProvider が page より
  // 上位にある app/App.tsx の route 構成が前提 (通知経路の正本: shared/notify.tsx 冒頭)。
  // 最後の事業所削除は actor 自身の連動削除 = AuthChange のため full reload で抜ける (ADR-0010 D3)。
  const handleDelete = () =>
    deleteCompany(companyId)
      .then(({ accountDeleted }) => {
        if (accountDeleted) {
          redirectAfterAuthChange("deleteAccount");
          return;
        }
        navigate("/account/companies");
        return notifyAfterRefresh(refresh, {
          done: `「${companyName}」を削除しました。`,
          staleShort: "事業所を削除しました",
        });
      })
      .catch((err) => {
        notifyError(
          describeRequestJsonError(err, {
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
            description={`「${companyName}」を削除します。この操作は元に戻せません。`}
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
