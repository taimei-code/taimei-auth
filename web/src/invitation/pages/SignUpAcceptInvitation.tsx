import { useAtomSet } from "@effect/atom-react";
import { Exit } from "effect";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { authClient } from "../../auth/auth-client";
import { redirectToSignIn } from "../../auth/auth-redirect";
import { FullScreenLoader } from "../../shared/FullScreenLoader";
import { failureMessage } from "../../shared/failure-message";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shared/ui/card";
import { acceptInvitationAtom } from "../invitation-atom";
import { redirectUrlAfterAccept } from "../redirect-target";

type AcceptRequestStatus = "processing" | "error";

const ACCEPT_FAILED = "招待の受諾に失敗しました。";

export const SignUpAcceptInvitation = () => {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState<AcceptRequestStatus>("processing");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const acceptInvitation = useAtomSet(acceptInvitationAtom, { mode: "promiseExit" });

  const invitationToken = searchParams.get("invitation_token");
  const redirectUrl = redirectUrlAfterAccept(searchParams);

  useEffect(() => {
    const fail = (message: string) => {
      setStatus("error");
      setErrorMessage(message);
    };

    if (!invitationToken) {
      fail("招待トークンが見つかりません。");
      return;
    }

    authClient
      .getSession()
      .then(({ data }) => {
        if (!data?.session) {
          redirectToSignIn();
          return;
        }
        return acceptInvitation({ payload: { invitation_token: invitationToken } }).then(
          Exit.match({
            onSuccess: () => window.location.replace(redirectUrl),
            onFailure: (cause) =>
              fail(
                failureMessage(
                  cause,
                  {
                    EmailMismatch:
                      "この招待は別のメールアドレス宛です。招待されたアドレスでログインし直してください。",
                    ExpiredOrUsed: "この招待は期限切れか、既に使用されています。",
                    NotFound: "招待が見つかりません。",
                    Unauthorized: ACCEPT_FAILED,
                  },
                  ACCEPT_FAILED,
                ),
              ),
          }),
        );
      })
      .catch(() => fail(ACCEPT_FAILED));
  }, [invitationToken, redirectUrl, acceptInvitation]);

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
