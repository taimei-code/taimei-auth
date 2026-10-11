import { Loader2, ShieldCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { AuthPageCard } from "../auth/AuthPageCard";
import { signInLandingSearch } from "../auth/auth-redirect";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import type { MfaChallengeFlow } from "./use-mfa-challenge-flow";

const ChallengeStatus = ({ label }: { label: string }) => (
  <div className="flex justify-center py-6" role="status" aria-live="polite">
    <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
    <span className="sr-only">{label}</span>
  </div>
);

const NEEDS_CHALLENGE_DESCRIPTION = "ログインを完了するには、追加の確認が必要です";

export const MfaChallengeLoading = () => (
  <AuthPageCard title="多要素認証 (MFA)" description={NEEDS_CHALLENGE_DESCRIPTION}>
    <ChallengeStatus label="読み込み中…" />
  </AuthPageCard>
);

export function MfaChallengeView({ view, entry }: MfaChallengeFlow) {
  return (
    <AuthPageCard
      title="多要素認証 (MFA)"
      description={
        view === "expired" ? "ログインをやり直してください" : NEEDS_CHALLENGE_DESCRIPTION
      }
    >
      {view === "redirecting" && <ChallengeStatus label="ログインを完了しています…" />}

      {view === "expired" && (
        <>
          <p className="text-sm text-muted-foreground">
            セッションの有効期限が切れました。お手数ですが、もう一度ログインしてください。
          </p>
          <Button asChild className="w-full">
            <Link to="/auth" search={signInLandingSearch()}>
              ログイン画面へ
            </Link>
          </Button>
        </>
      )}

      {view === "entry" && (
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
              to="/auth"
              search={signInLandingSearch()}
              className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              ログインをやり直す
            </Link>
          </p>

          {entry.errorMessage && (
            <p id={entry.errorId} role="alert" className="text-sm text-destructive">
              {entry.errorMessage}
            </p>
          )}
        </>
      )}
    </AuthPageCard>
  );
}
