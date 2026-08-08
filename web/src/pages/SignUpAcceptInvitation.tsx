import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { FullScreenLoader } from "@/components/FullScreenLoader";
import { authClient } from "@/lib/auth-client";
import { acceptInvitation, describeAccountApiError } from "@/lib/account-api";
import { redirectToSignIn } from "@/lib/auth-redirect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type AcceptRequestStatus = "processing" | "error";

// 招待メールの 1-click magic link で認証後、callbackURL でここに着地する。
// invitation_token を accept API に渡し membership を作成 → /account へ。
// strict email match (session.email !== invitation.email) は 403 でエラー表示。
export const SignUpAcceptInvitation = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<AcceptRequestStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string>("");

  const invitationToken = searchParams.get("invitation_token");

  useEffect(() => {
    if (!invitationToken) {
      setStatus("error");
      setErrorMessage("招待トークンが見つかりません。");
      return;
    }

    authClient
      .getSession()
      .then(({ data }) => {
        if (!data?.session) {
          redirectToSignIn();
          return null;
        }
        return acceptInvitation(invitationToken);
      })
      .then((result) => {
        if (!result) return; // 未認証で redirect 済
        window.location.replace("/account");
      })
      .catch((err) => {
        setStatus("error");
        setErrorMessage(
          describeAccountApiError(err, {
            403: "この招待は別のメールアドレス宛です。招待されたアドレスでログインし直してください。",
            410: "この招待は期限切れか、既に使用されています。",
            404: "招待が見つかりません。",
            fallback: "招待の受諾に失敗しました。",
          }),
        );
      });
  }, [invitationToken]);

  if (status === "processing") {
    return <FullScreenLoader />;
  }

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>招待を受諾できませんでした</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href="/account"
            className="text-sm font-medium text-foreground underline underline-offset-4"
          >
            アカウントに戻る
          </a>
        </CardContent>
      </Card>
    </div>
  );
};
