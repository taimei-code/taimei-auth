import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";

import { activateMfa, enrollMfa, MfaApiError, type MfaEnrollment } from "@/lib/mfa-api";
import { describeMfaChallengeError, useMfaCodeEntry } from "@/lib/use-mfa-code-entry";
import { notifyAfterRefresh } from "@/components/notify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const CODE_INPUT_ID = "mfa-enroll-code";

// 登録は「読み取る → 確認コードで検証 → リカバリーコードを控える」の 3 段で、戻れるのは
// 検証まで。リカバリーコードは activate 成功時に一度だけ手渡され、以後 server から読み戻す
// 経路が無いため、この state に載っている間だけが本人に渡せる唯一の機会になる。
type EnrollState =
  | { step: "starting" }
  | { step: "scan"; enrollment: MfaEnrollment }
  | { step: "verify"; enrollment: MfaEnrollment }
  | { step: "recoveryCodes"; recoveryCodes: string[] }
  | { step: "failed"; message: string };

// otpauth:// URI から手入力用の secret を取り出す。QR を読めない端末 (カメラが無い / 認証アプリが
// 別端末) の唯一の登録手段だが、URI 形式が想定外でも QR 側は出せるよう null に倒す。
const readTotpSecret = (totpUri: string): string | null =>
  URL.canParse(totpUri) ? new URL(totpUri).searchParams.get("secret") : null;

const CopyButton = ({ value, label }: { value: string; label: string }) => {
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (result === "idle") return;
    const timer = setTimeout(() => setResult("idle"), 3_000);
    return () => clearTimeout(timer);
  }, [result]);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => setResult("copied"))
      .catch(() => setResult("failed"));
  };

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
        {result === "copied" ? (
          <Check className="size-4" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
        {label}
      </Button>
      {result !== "idle" && (
        <span
          className={
            result === "copied" ? "text-xs text-muted-foreground" : "text-xs text-destructive"
          }
        >
          {result === "copied" ? "コピーしました" : "コピーできませんでした"}
        </span>
      )}
    </div>
  );
};

// QR 描画は有効化ダイアログを開いた時にしか要らないため動的 import で entry chunk から外す
// (サインイン初期表示に不要な JS を配らない方針の正本は components/notify.tsx のコメント)。
// 取得に失敗しても secret の手入力で登録は完了できるので、描画を諦めて案内に倒す。
const TotpQrCode = ({ totpUri }: { totpUri: string }) => {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    import("qrcode")
      .then(({ toDataURL }) => toDataURL(totpUri, { width: 192, margin: 1 }))
      .then((url) => {
        if (active) setDataUrl(url);
      })
      .catch(() => {
        if (active) setUnavailable(true);
      });
    return () => {
      active = false;
    };
  }, [totpUri]);

  if (unavailable) {
    return (
      <p className="text-sm text-muted-foreground">
        QR コードを表示できませんでした。下の secret を認証アプリに手入力してください。
      </p>
    );
  }
  if (!dataUrl) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      </div>
    );
  }
  return (
    <img
      src={dataUrl}
      width={192}
      height={192}
      alt="認証アプリで読み取る QR コード"
      className="mx-auto rounded-md border border-border bg-white p-2"
    />
  );
};

type Props = {
  // 有効化の完了後に呼ぶ (セキュリティページの状態再取得)。
  onEnabled: () => Promise<unknown>;
  trigger: ReactNode;
};

export const MfaEnrollDialog = ({ onEnabled, trigger }: Props) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EnrollState>({ step: "starting" });

  const entry = useMfaCodeEntry({
    inputId: CODE_INPUT_ID,
    submit: ({ code }) => {
      if (state.step !== "verify") return Promise.resolve();
      const { recovery_codes } = state.enrollment;
      return activateMfa(code).then(() =>
        setState({ step: "recoveryCodes", recoveryCodes: recovery_codes }),
      );
    },
  });

  const totpSecret = state.step === "scan" ? readTotpSecret(state.enrollment.totp_uri) : null;

  const handleOpenChange = (next: boolean) => {
    if (state.step === "starting" && open) return; // enroll 応答待ちに閉じられると宙ぶらりんの登録が残る
    if (entry.submitting) return;

    if (next) {
      setState({ step: "starting" });
      entry.reset();
      setOpen(true);
      enrollMfa()
        .then((enrollment) => setState({ step: "scan", enrollment }))
        .catch((error: unknown) =>
          setState({
            step: "failed",
            message: describeMfaChallengeError(
              error instanceof MfaApiError ? error.code : "unknown",
            ),
          }),
        );
      return;
    }

    setOpen(false);
    // 有効化が確定した後に閉じた時だけ再取得する。検証前に離脱した場合はまだ無効のままで、
    // 放置された未検証の登録は次回の enroll が上書きする。
    if (state.step === "recoveryCodes") {
      void notifyAfterRefresh(onEnabled, {
        done: "多要素認証 (MFA) を有効にしました。",
        staleShort: "多要素認証 (MFA) を有効にしました",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>多要素認証 (MFA) を有効にする</DialogTitle>
          <DialogDescription>
            {state.step === "recoveryCodes"
              ? "リカバリーコードを安全な場所に保管してください。"
              : "認証アプリを登録すると、ログイン時に確認コードの入力を求めます。"}
          </DialogDescription>
        </DialogHeader>

        {state.step === "starting" && (
          <div className="flex justify-center py-8" role="status" aria-live="polite">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">読み込み中…</span>
          </div>
        )}

        {state.step === "failed" && (
          <p className="py-2 text-sm text-destructive">{state.message}</p>
        )}

        {state.step === "scan" && (
          <div className="space-y-4">
            <TotpQrCode totpUri={state.enrollment.totp_uri} />
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                認証アプリで QR コードを読み取ってください。読み取れない場合は、次の secret
                を手入力します。
              </p>
              <p
                className="break-all rounded-md bg-muted px-3 py-2 font-mono text-sm"
                translate="no"
              >
                {totpSecret ?? "—"}
              </p>
              {totpSecret !== null && <CopyButton value={totpSecret} label="secret をコピー" />}
            </div>
            <DialogFooter>
              <Button onClick={() => setState({ step: "verify", enrollment: state.enrollment })}>
                次へ
              </Button>
            </DialogFooter>
          </div>
        )}

        {state.step === "verify" && (
          <form onSubmit={entry.handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={CODE_INPUT_ID}>{entry.labelText}</Label>
              <Input {...entry.inputProps} />
              <p id={entry.hintId} className="text-xs text-muted-foreground">
                {entry.hint}
              </p>
            </div>
            {entry.errorMessage && (
              <p id={entry.errorId} role="alert" className="text-sm text-destructive">
                {entry.errorMessage}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={entry.submitting}
                onClick={() => setState({ step: "scan", enrollment: state.enrollment })}
              >
                戻る
              </Button>
              <Button type="submit" disabled={!entry.canSubmit}>
                {entry.submitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ShieldCheck className="size-4" aria-hidden="true" />
                )}
                有効にする
              </Button>
            </DialogFooter>
          </form>
        )}

        {state.step === "recoveryCodes" && (
          <div className="space-y-4">
            <p className="text-sm text-destructive">
              このダイアログを閉じると再表示できません。認証アプリを使えなくなった時の唯一の
              ログイン手段なので、必ず控えてから閉じてください。
            </p>
            <ul className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3" translate="no">
              {state.recoveryCodes.map((code) => (
                <li key={code} className="font-mono text-sm">
                  {code}
                </li>
              ))}
            </ul>
            <CopyButton value={state.recoveryCodes.join("\n")} label="リカバリーコードをコピー" />
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>控えたので閉じる</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
