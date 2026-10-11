import { useAtomSet } from "@effect/atom-react";
import { Exit } from "effect";
import { type FormEvent, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import type { OrgCode } from "@core/company/org-code";

import type { Membership } from "../account/current-company";
import { redirectAfterAuthChange } from "../auth/auth-redirect";
import { ConfirmDestructiveDialog } from "../shared/ConfirmDestructiveDialog";
import { failureMessage } from "../shared/failure-message";
import { notifyAfterRefresh, notifyError } from "../shared/notify";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import { Separator } from "../shared/ui/separator";
import { OrgCodeField } from "./OrgCodeField";
import { deleteCompanyAtom, updateCompanyAtom } from "./company-atom";

const UPDATE_FAILED = "更新に失敗しました。";
const DELETE_FAILED = "事業所の削除に失敗しました。";

type Props = {
  membership: Membership;
  isLastCompany: boolean;
  refresh: () => Promise<void>;
};

export const CompanySettingsForm = ({ membership, isLastCompany, refresh }: Props) => {
  const companyId = membership.company_id;
  const [name, setName] = useState(membership.company_name);
  const [orgCode, setOrgCode] = useState<OrgCode>(
    membership.company_org_code === "CORPORATE" ? "CORPORATE" : "PERSONAL",
  );
  const [submitting, setSubmitting] = useState(false);
  const updateCompany = useAtomSet(updateCompanyAtom, { mode: "promiseExit" });

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    updateCompany({ params: { companyId }, payload: { name: name.trim(), org_code: orgCode } })
      .then(
        Exit.match({
          onSuccess: () =>
            notifyAfterRefresh(refresh, {
              done: "事業所情報を更新しました。",
              staleShort: "事業所情報を更新しました",
            }),
          onFailure: (cause) =>
            notifyError(
              failureMessage(
                cause,
                {
                  Forbidden: "編集する権限がありません。",
                  NotFound: UPDATE_FAILED,
                  Unauthorized: UPDATE_FAILED,
                },
                UPDATE_FAILED,
              ),
            ),
        }),
      )
      .finally(() => setSubmitting(false));
  };

  return (
    <>
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

      <DeleteCompanySection
        membership={membership}
        isLastCompany={isLastCompany}
        refresh={refresh}
        disabled={submitting}
      />
    </>
  );
};

const DeleteCompanySection = ({
  membership,
  isLastCompany,
  refresh,
  disabled,
}: Props & { disabled: boolean }) => {
  const companyId = membership.company_id;
  const companyName = membership.company_name;
  const navigate = useNavigate();
  const deleteCompany = useAtomSet(deleteCompanyAtom, { mode: "promiseExit" });

  const handleDelete = () =>
    deleteCompany({ params: { companyId } }).then(
      Exit.match({
        onSuccess: ({ account_deleted }) => {
          if (account_deleted) {
            redirectAfterAuthChange("deleteAccount");
            return;
          }
          void navigate({ to: "/account/companies" });
          return notifyAfterRefresh(refresh, {
            done: `「${companyName}」を削除しました。`,
            staleShort: "事業所を削除しました",
          });
        },
        onFailure: (cause) =>
          notifyError(
            failureMessage(
              cause,
              {
                Forbidden: "この事業所を削除する権限がないか、既に削除されています。",
                LastOwner: DELETE_FAILED,
                Unauthorized: DELETE_FAILED,
              },
              DELETE_FAILED,
            ),
          ),
      }),
    );

  return (
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
            <Button variant="destructive" disabled={disabled}>
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
  );
};
