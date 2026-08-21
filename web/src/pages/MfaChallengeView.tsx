import { Loader2, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
// 純描画 view を bun test (cwd = repo root) から読むため相対 import にする ("@/*" の割り当てが
// root と web で違う理由は web/tsconfig.json のコメント。ui 部品が引く "@/lib/utils" だけは
// test 側の mock.module で解決する)。
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { signInLandingUrl } from "../lib/auth-redirect";
import type { MfaChallengeFlowState } from "../lib/mfa-challenge-flow";
import type { MfaErrorCode } from "../lib/mfa-api";
import type { MfaCodeInput } from "../lib/use-mfa-code-entry";

export function MfaChallengeView({
  state,
  entry,
}: {
  state: MfaChallengeFlowState<MfaErrorCode>;
  entry: MfaCodeInput;
}) {
  const showsEntry = state.phase === "ready" || state.phase === "verifying";
  const showsProgress = state.phase === "observing" || state.phase === "redirecting";

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>多要素認証 (MFA)</CardTitle>
          <CardDescription>
            {state.phase === "expired"
              ? "ログインをやり直してください"
              : "ログインを完了するには、追加の確認が必要です"}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {showsProgress && (
            <div className="flex justify-center py-6" role="status" aria-live="polite">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">
                {state.phase === "redirecting" ? "ログインを完了しています…" : "読み込み中…"}
              </span>
            </div>
          )}

          {state.phase === "expired" && (
            <>
              <p className="text-sm text-muted-foreground">
                セッションの有効期限が切れました。お手数ですが、もう一度ログインしてください。
              </p>
              <Button asChild className="w-full">
                <Link to={signInLandingUrl()}>ログイン画面へ</Link>
              </Button>
            </>
          )}

          {showsEntry && (
            <>
              <form onSubmit={entry.handleSubmit} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor={entry.inputProps.id}>{entry.labelText}</Label>
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

          {/* ready 以外で失敗文言を残さない理由は use-mfa-challenge-flow.ts の errorCode 導出コメント */}
          {state.phase === "ready" && entry.errorMessage && (
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
}
