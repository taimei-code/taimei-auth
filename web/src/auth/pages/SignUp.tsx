import { useState } from "react";
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

const route = getRouteApi("/auth/signup");

export const SignUp = () => {
  const search = route.useSearch();
  const [name, setName] = useState("");
  const sign = useSignPage(search, {
    preferSignUpUrl: true,
    githubErrorFallback: "GitHub サインアップに失敗しました",
  });

  return (
    <>
      <CanaryTokens />
      <AuthPageCard
        title={`${sign.serviceDisplayName} に登録`}
        description="Magic Link または GitHub で新規登録"
      >
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
                {sign.submitting === "magic-link" ? <Loader2 className="animate-spin" /> : <Mail />}
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
                to="/auth"
                search={declaredSignInParams(search)}
                className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                ログイン
              </Link>
            </p>
          </>
        )}

        {sign.errorMessage && <p className="text-sm text-destructive">{sign.errorMessage}</p>}
      </AuthPageCard>
    </>
  );
};
