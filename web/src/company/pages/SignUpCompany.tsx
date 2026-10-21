import { Exit } from "effect";
import { getRouteApi, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";

import type { OrgCode } from "@core/company/org-code";

import { SIGN_OUT_FAILED, signOut } from "../../auth/sign-out";
import { failureOutcome } from "../../shared/failure-message";
import { leaveSpaTo, signInLandingSearch } from "../../shared/leave-spa";
import { Button } from "../../shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../shared/ui/card";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { OrgCodeField } from "../OrgCodeField";
import { useCreateCompany } from "../company-atom";

const route = getRouteApi("/auth/signup/company");

export const SignUpCompany = () => {
  const redirectUrl = route.useSearch().redirect_url;
  const navigate = useNavigate();
  const createCompany = useCreateCompany();
  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState<OrgCode>("PERSONAL");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    createCompany({ name: name.trim(), org_code: orgCode }).then(
      Exit.match({
        onSuccess: () => leaveSpaTo(redirectUrl),
        onFailure: (cause) => {
          const createdInAnotherTab: boolean = failureOutcome(
            cause,
            { AlreadyExists: true },
            false,
          );
          if (createdInAnotherTab) {
            leaveSpaTo(redirectUrl);
            return;
          }
          setErrorMessage("事業所登録に失敗しました");
          setSubmitting(false);
        },
      }),
    );
  };

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>事業所を登録してください</CardTitle>
          <CardDescription>taimei では事業所単位で課金 / メンバー管理を行います。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4" aria-label="事業所登録フォーム">
            <div className="space-y-2">
              <Label htmlFor="company-name">事業所名</Label>
              <Input
                id="company-name"
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
              name="org_code"
            />
            <Button type="submit" className="w-full" disabled={submitting || name.trim() === ""}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              事業所を作成
            </Button>
            {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
          </form>
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          URL が auth.taimei-code.com であることを確認してください
        </CardFooter>
      </Card>
      <button
        type="button"
        onClick={async () => {
          if ((await signOut()) === "failed") {
            setErrorMessage(SIGN_OUT_FAILED);
            return;
          }
          await navigate({ to: "/auth", search: signInLandingSearch(), reloadDocument: true });
        }}
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        別のアカウントでログインする
      </button>
    </div>
  );
};
