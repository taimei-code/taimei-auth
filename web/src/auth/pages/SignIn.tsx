import { getRouteApi, Link } from "@tanstack/react-router";
import { Mail, Loader2 } from "lucide-react";

import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { AuthPageCard } from "../AuthPageCard";
import { CanaryTokens } from "../CanaryTokens";
import { declaredSignInParams } from "../sign-params";
import { SocialSignInSection } from "../SocialSignInSection";
import { useSignPage } from "../use-sign-page";

const route = getRouteApi("/auth/");

export const SignIn = () => {
  const search = route.useSearch();
  const sign = useSignPage(search, { githubErrorFallback: "GitHub ログインに失敗しました" });

  return (
    <>
      <CanaryTokens />
      <AuthPageCard
        title={`${sign.serviceDisplayName} にログイン`}
        description="Magic Link または GitHub アカウントでログイン"
      >
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
                {sign.submitting === "magic-link" ? <Loader2 className="animate-spin" /> : <Mail />}
                Magic Link を送信
              </Button>
            </form>

            <SocialSignInSection
              isInvitation={sign.isInvitation}
              disabled={sign.submitting !== null}
              submittingGitHub={sign.submitting === "github"}
              label="GitHub でログイン"
              onGitHub={sign.handleGitHub}
            />

            <p className="text-center text-sm text-muted-foreground">
              アカウントをお持ちでない方は{" "}
              <Link
                to="/auth/signup"
                search={declaredSignInParams(search)}
                className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                新規登録
              </Link>
            </p>
          </>
        )}

        {sign.errorMessage && <p className="text-sm text-destructive">{sign.errorMessage}</p>}
      </AuthPageCard>
    </>
  );
};
