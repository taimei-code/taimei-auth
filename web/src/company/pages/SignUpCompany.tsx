import { useAtomSet } from "@effect/atom-react";
import { Exit } from "effect";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import type { OrgCode } from "@core/company/org-code";
import { signInParamsSchema } from "@core/sign-in-params";

import { companyStateAtom } from "../../account/account-atom";
import { authClient } from "../../auth/auth-client";
import {
  discardStaleSession,
  isStaleSessionError,
  redirectToSignIn,
  signInLandingUrl,
} from "../../auth/auth-redirect";
import { useWaitForValue } from "../../shared/atom-runtime";
import { hasFailureTag } from "../../shared/failure-message";
import { FullScreenLoader } from "../../shared/FullScreenLoader";
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
import { createCompanyAtom } from "../company-atom";

const useCompanySignupGuard = (redirectUrl: string): boolean => {
  const readCompanyState = useWaitForValue(companyStateAtom);
  const [needsInput, setNeedsInput] = useState(false);

  useEffect(() => {
    authClient
      .getSession()
      .then(({ data }) => {
        if (!data?.session) {
          redirectToSignIn();
          return null;
        }
        return readCompanyState().then((state) => state.memberships);
      })
      .then((memberships) => {
        if (memberships === null) return;
        if (memberships.length > 0) {
          window.location.replace(redirectUrl);
          return;
        }
        setNeedsInput(true);
      })
      .catch((e) => {
        if (isStaleSessionError(e)) {
          discardStaleSession(() => authClient.signOut());
          return;
        }
        setNeedsInput(true);
      });
  }, [redirectUrl, readCompanyState]);

  return needsInput;
};

// server の guard はこのパスを除外し SessionGuard も /auth/* を覆わないため、guard をここに置く
export const SignUpCompany = () => {
  const [searchParams] = useSearchParams();
  const parsed = signInParamsSchema.safeParse(Object.fromEntries(searchParams));
  const redirectUrl = parsed.success ? parsed.data.redirect_url : "/account";
  const needsInput = useCompanySignupGuard(redirectUrl);

  if (!needsInput) {
    return <FullScreenLoader />;
  }

  return <SignUpCompanyForm redirectUrl={redirectUrl} />;
};

const SignUpCompanyForm = ({ redirectUrl }: { redirectUrl: string }) => {
  const navigate = useNavigate();
  const createCompany = useAtomSet(createCompanyAtom, { mode: "promiseExit" });
  const [name, setName] = useState("");
  const [orgCode, setOrgCode] = useState<OrgCode>("PERSONAL");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMessage(null);
    createCompany({ payload: { name: name.trim(), org_code: orgCode } }).then(
      Exit.match({
        onSuccess: () => window.location.replace(redirectUrl),
        onFailure: (cause) => {
          const createdInAnotherTab = hasFailureTag(cause, "AlreadyExists");
          if (createdInAnotherTab) {
            window.location.replace(redirectUrl);
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
