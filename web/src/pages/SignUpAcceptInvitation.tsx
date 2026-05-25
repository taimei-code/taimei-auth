import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { AccountApiError, acceptInvitation } from "@/lib/account-api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Status = "processing" | "error";

// 招待メールの 1-click magic link で認証後、callbackURL でここに着地する。
// invitation_token を accept API に渡し membership を作成 → /account へ。
// strict email match (session.email !== invitation.email) は 403 でエラー表示。
export const SignUpAcceptInvitation = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<Status>("processing");
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
          const returnTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
          window.location.replace(
            `/auth/?service_name=accounts&redirect_url=${encodeURIComponent(returnTo)}`,
          );
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
        if (err instanceof AccountApiError && err.status === 403) {
          setErrorMessage(
            "この招待は別のメールアドレス宛です。招待されたアドレスでログインし直してください。",
          );
        } else if (err instanceof AccountApiError && err.status === 410) {
          setErrorMessage("この招待は期限切れか、既に使用されています。");
        } else if (err instanceof AccountApiError && err.status === 404) {
          setErrorMessage("招待が見つかりません。");
        } else {
          setErrorMessage("招待の受諾に失敗しました。");
        }
      });
  }, [invitationToken]);

  if (status === "processing") {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
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
