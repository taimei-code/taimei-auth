import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";

import { notifyAfterRefresh } from "../shared/notify";
import { Button } from "../shared/ui/button";
import { Input } from "../shared/ui/input";
import { Label } from "../shared/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../shared/ui/dialog";
import { activateMfa, enrollMfa, mfaErrorCodeOf, type MfaEnrollment } from "./mfa-api";
import { describeMfaChallengeError, useMfaCodeEntry } from "./use-mfa-code-entry";

const CODE_INPUT_ID = "mfa-enroll-code";

type EnrollState =
  | { step: "starting" }
  | { step: "scan"; enrollment: MfaEnrollment }
  | { step: "verify"; enrollment: MfaEnrollment }
  | { step: "recoveryCodes"; recoveryCodes: string[] }
  | { step: "failed"; message: string };

// QR を読めない端末にとって唯一の登録手段である。URI が想定外の形でも QR 側は出せるよう、null を返す。
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

// 取得に失敗しても secret の手入力で登録は完了できるため、描画をやめて案内文に切り替える。
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
  onEnabled: () => Promise<unknown>;
  trigger: ReactNode;
};

export const MfaEnrollDialog = ({ onEnabled, trigger }: Props) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EnrollState>({ step: "starting" });
  // 登録途中の再 enroll に server が同じ内容を返すこと (ADR-0013) を利用した表示用の cache。
  const [resumableEnrollment, setResumableEnrollment] = useState<MfaEnrollment | null>(null);

  const entry = useMfaCodeEntry({
    inputId: CODE_INPUT_ID,
    submit: ({ code }) => {
      if (state.step !== "verify") return Promise.resolve();
      const { recoveryCodes } = state.enrollment;
      return activateMfa({ code, enrollmentId: state.enrollment.enrollmentId })
        .then(() => {
          setResumableEnrollment(null);
          setState({ step: "recoveryCodes", recoveryCodes });
        })
        .catch((error: unknown) => {
          // cache を保持したままだと、開き直しても古い登録を再表示して 409 を繰り返す。
          if (mfaErrorCodeOf(error) === "enrollment_changed") {
            setResumableEnrollment(null);
          }
          throw error;
        });
    },
  });

  const totpSecret = state.step === "scan" ? readTotpSecret(state.enrollment.totpUri) : null;

  const handleOpenChange = (next: boolean) => {
    if (state.step === "starting" && open) return; // enroll の応答待ちに閉じられると、途中のままの登録が残る
    if (entry.submitting) return;

    if (next) {
      entry.reset();
      setOpen(true);
      if (resumableEnrollment !== null) {
        setState({ step: "scan", enrollment: resumableEnrollment });
        return;
      }
      setState({ step: "starting" });
      enrollMfa()
        .then((enrollment) => {
          setResumableEnrollment(enrollment);
          setState({ step: "scan", enrollment });
        })
        .catch((error: unknown) =>
          setState({
            step: "failed",
            message: describeMfaChallengeError(mfaErrorCodeOf(error)),
          }),
        );
      return;
    }

    setOpen(false);
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
            <TotpQrCode totpUri={state.enrollment.totpUri} />
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
