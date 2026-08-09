import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, ShieldCheck } from "lucide-react";

import { signInLandingUrl } from "@/lib/auth-redirect";
import { getMfaChallenge, MfaApiError, verifyMfaChallenge, type MfaCodeKind } from "@/lib/mfa-api";
import { useMfaCodeEntry } from "@/lib/use-mfa-code-entry";
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

type ChallengeState = "loading" | "pending" | "expired";

const CODE_INPUT_ID = "mfa-challenge-code";

// 一次認証 (Magic Link / GitHub OAuth) の後に第二要素を要求する画面。ここへ来た時点で
// セッションは存在せず、認証材料は署名付き cookie が指す MFA チャレンジだけ。
// 設計詳細: docs/adr/0013-mfa-totp-challenge.md
export const MfaChallenge = () => {
  const [state, setState] = useState<ChallengeState>("loading");

  useEffect(() => {
    // 取得できないことはチャレンジ不在を意味しない (通信断でも失敗する)。合否は verify で
    // server が決めるため、失敗時は入力欄を出したままにして再ログインへ追い返さない。
    getMfaChallenge()
      .then(({ pending }) => setState(pending ? "pending" : "expired"))
      .catch(() => setState("pending"));
  }, []);

  const submit = (input: { code: string; kind: MfaCodeKind }) =>
    verifyMfaChallenge(input).then(
      ({ redirect_url }) => {
        // 遷移先の出口検証は server が済ませている (src/mfa/redirect-guard.ts)。ここで
        // 再検証しないのは、判定に要る trusted origins が SPA 側に無く、独自規則を足すと
        // 二重の allowlist ができて片方だけ更新される事故になるため。
        window.location.href = redirect_url;
      },
      (error: unknown) => {
        // 試行上限に達するとチャレンジは黙って破棄され、以後は正しいコードでも通らない。
        // invalid_code のたびに保留状態を問い直し、消えていたら再ログイン誘導に切り替える。
        if (error instanceof MfaApiError && error.code === "invalid_code") {
          return getMfaChallenge()
            .then(({ pending }) => {
              if (!pending) setState("expired");
            })
            .catch(() => undefined)
            .then(() => {
              throw error;
            });
        }
        throw error;
      },
    );

  const entry = useMfaCodeEntry({ inputId: CODE_INPUT_ID, submit });

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>多要素認証 (MFA)</CardTitle>
          <CardDescription>
            {state === "expired"
              ? "ログインをやり直してください"
              : "ログインを完了するには、追加の確認が必要です"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {state === "loading" && (
            <div className="flex justify-center py-6" role="status" aria-live="polite">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">読み込み中…</span>
            </div>
          )}

          {state === "expired" && (
            <>
              <p className="text-sm text-muted-foreground">
                セッションの有効期限が切れました。お手数ですが、もう一度ログインしてください。
              </p>
              <Button asChild className="w-full">
                <Link to={signInLandingUrl()}>ログイン画面へ</Link>
              </Button>
            </>
          )}

          {state === "pending" && (
            <>
              <form onSubmit={entry.handleSubmit} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={CODE_INPUT_ID}>{entry.labelText}</Label>
                  <Input {...entry.inputProps} />
                  <p id={entry.hintId} className="text-xs text-muted-foreground">
                    {entry.hint}
                  </p>
                </div>
                <Button type="submit" className="w-full" disabled={!entry.canSubmit}>
                  {entry.submitting ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <ShieldCheck aria-hidden="true" />
                  )}
                  ログインを続ける
                </Button>
              </form>

              <div className="text-center">
                <button
                  type="button"
                  onClick={entry.toggleKind}
                  disabled={entry.submitting}
                  className="rounded-sm text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {entry.toggleLabel}
                </button>
              </div>

              <p className="text-center text-sm text-muted-foreground">
                認証アプリもリカバリーコードも使えない場合は{" "}
                <Link
                  to={signInLandingUrl()}
                  className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ログインをやり直す
                </Link>
              </p>
            </>
          )}

          {/* チャレンジ消滅を検知して expired に移った直後は、直前の失敗文言を残さない
              (「コードが違う」と「やり直し」が並ぶと、打ち直せば通るように読める)。 */}
          {state === "pending" && entry.errorMessage && (
            <p id={entry.errorId} role="alert" className="text-sm text-destructive">
              {entry.errorMessage}
            </p>
          )}
        </CardContent>

        <CardFooter className="text-xs text-muted-foreground">
          URL が auth.taimei-code.com であることを確認してください
        </CardFooter>
      </Card>
    </div>
  );
};
