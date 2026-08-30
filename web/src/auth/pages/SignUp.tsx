import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail, Loader2 } from "lucide-react";

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
import { CanaryTokens } from "../CanaryTokens";
import { SocialSignInSection } from "../SocialSignInSection";
import { buildSignParams } from "../sign-params";
import { useSignPage } from "../use-sign-page";

// 状態機械は useSignPage、SNS 区画は SocialSignInSection を SignIn と共有する (ADR-0007: 画面のみ分離)。
export const SignUp = () => {
  const [searchParams] = useSearchParams();
  const [name, setName] = useState("");
  const sign = useSignPage({
    preferSignUpUrl: true,
    githubErrorFallback: "GitHub サインアップに失敗しました",
  });

  if (!sign.paramsValid) {
    window.location.replace("/auth/error?reason=invalid_redirect_url");
    return null;
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <CanaryTokens />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{sign.serviceDisplayName} に登録</CardTitle>
          <CardDescription>Magic Link または GitHub で新規登録</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sign.magicLinkSent ? (
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">{sign.email}</strong> に Magic Link
              を送信しました。メール内のリンクをクリックして登録を完了してください。
            </p>
          ) : (
            <>
              <form onSubmit={(e) => sign.handleMagicLink(e, { name })} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="name">お名前</Label>
                  <Input
                    id="name"
                    type="text"
                    required
                    placeholder="山田 太郎"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={sign.submitting !== null}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">メールアドレス</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={sign.email}
                    onChange={(e) => sign.setEmail(e.target.value)}
                    disabled={sign.submitting !== null}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={sign.submitting !== null || sign.email === "" || name === ""}
                >
                  {sign.submitting === "magic-link" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Mail />
                  )}
                  Magic Link で登録
                </Button>
              </form>

              <SocialSignInSection
                isInvitation={sign.isInvitation}
                disabled={sign.submitting !== null}
                submittingGitHub={sign.submitting === "github"}
                label="GitHub で登録"
                onGitHub={sign.handleGitHub}
              />

              <p className="text-center text-sm text-muted-foreground">
                すでにアカウントをお持ちの方は{" "}
                <Link
                  to={`/auth?${buildSignParams(searchParams)}`}
                  className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ログイン
                </Link>
              </p>
            </>
          )}

          {sign.errorMessage && <p className="text-sm text-destructive">{sign.errorMessage}</p>}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          URL が auth.taimei-code.com であることを確認してください
        </CardFooter>
      </Card>
    </div>
  );
};
