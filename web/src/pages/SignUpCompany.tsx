import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { FullScreenLoader } from "@/components/FullScreenLoader";
import { OrgCodeField } from "@/components/account/OrgCodeField";
import { authClient } from "@/lib/auth-client";
import { AccountApiError, createCompany, listMyMemberships, type OrgCode } from "@/lib/account-api";
import { redirectToSignIn, signInLandingUrl } from "@/lib/auth-redirect";
import { signInParamsSchema } from "@core/sign-in-params";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type GuardStatus = "loading" | "needs-input" | "already-has-company";

// ADR-009: signup フローの「事業所登録」ステップ。
// 未認証 → /auth/、認証済 + membership ≥ 1 → 完了済として redirect。
// 認証済 + membership = 0 のときだけ入力フォームを表示する
// (server-side guard auth-entry-redirect.ts と SessionGuard に続く 3 層目の page-self guard)。
export const SignUpCompany = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState<OrgCode>("PERSONAL");
  const [status, setStatus] = useState<GuardStatus>("loading");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parseResult = useMemo(
    () => signInParamsSchema.safeParse(Object.fromEntries(searchParams)),
    [searchParams],
  );

  const redirectUrl = parseResult.success ? parseResult.data.redirect_url : "/account";

  // biome-ignore lint/correctness/useExhaustiveDependencies: redirectUrl は searchParams 由来で再 mount しない限り変動しない
  useEffect(() => {
    authClient
      .getSession()
      .then(({ data }) => {
        if (!data?.session) {
          redirectToSignIn();
          return null;
        }
        return listMyMemberships();
      })
      .then((memberships) => {
        if (memberships === null) return; // 未認証で既に redirect 済
        if (memberships.length > 0) {
          setStatus("already-has-company");
          window.location.replace(redirectUrl);
          return;
        }
        setStatus("needs-input");
      })
      .catch((e) => {
        console.error("listMyMemberships failed", e);
        setStatus("needs-input");
      });
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    createCompany({ name: name.trim(), org_code: orgCode })
      .then(() => window.location.replace(redirectUrl))
      .catch((err) => {
        // 別 tab で同 user の CreateCompany が成功 (409) → 素直に redirect。
        if (err instanceof AccountApiError && err.status === 409) {
          window.location.replace(redirectUrl);
          return;
        }
        setErrorMessage(err instanceof AccountApiError ? err.message : "事業所登録に失敗しました");
        setSubmitting(false);
      });
  };

  if (status === "loading" || status === "already-has-company") {
    return <FullScreenLoader />;
  }

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
        onClick={() => {
          authClient
            .signOut()
            .then(() => navigate(signInLandingUrl()))
            .catch((e) => console.error("signOut failed:", e));
        }}
        className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
      >
        別のアカウントでログインする
      </button>
    </div>
  );
};
