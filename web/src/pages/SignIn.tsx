import { Link } from "react-router-dom";
import { Mail, Loader2 } from "lucide-react";

import { buildSignParams } from "@/lib/sign-params";
import { useSignPage } from "@/lib/use-sign-page";
import { CanaryTokens } from "@/components/CanaryTokens";
import { SocialSignInSection } from "@/components/auth/SocialSignInSection";
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

// 状態機械 (params 解析 / 招待分岐 / 送信) は useSignPage、SNS 区画は SocialSignInSection を
// SignUp と共有する (ADR-0007: 画面のみ分離)。
export const SignIn = () => {
  const sign = useSignPage({ githubErrorFallback: "GitHub ログインに失敗しました" });

  if (!sign.valid) {
    window.location.replace("/auth/error?reason=invalid_redirect_url");
    return null;
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <CanaryTokens />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{sign.serviceDisplayName} にログイン</CardTitle>
          <CardDescription>Magic Link または GitHub アカウントでログイン</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {sign.magicLinkSent ? (
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">{sign.email}</strong> に Magic Link
              を送信しました。メール内のリンクをクリックしてログインを完了してください。
            </p>
          ) : (
            <>
              <form onSubmit={sign.handleMagicLink} className="space-y-3">
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
                  disabled={sign.submitting !== null || sign.email === ""}
                >
                  {sign.submitting === "magic-link" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Mail />
                  )}
                  Magic Link を送信
                </Button>
              </form>

              <SocialSignInSection
                isInvitation={sign.isInvitation}
                submitting={sign.submitting}
                label="GitHub でログイン"
                onGitHub={sign.handleGitHub}
              />

              <p className="text-center text-sm text-muted-foreground">
                アカウントをお持ちでない方は{" "}
                <Link
                  to={`/auth/signup?${buildSignParams(sign.searchParams)}`}
                  className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  新規登録
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
