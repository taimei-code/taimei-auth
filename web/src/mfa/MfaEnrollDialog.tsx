import { type Cause, Exit } from "effect";
import { useEffect, useState, type ReactNode } from "react";
import { Check, Copy, Loader2, ShieldCheck } from "lucide-react";

import type { MfaEnrollment } from "@core/mfa/mfa-contract";

import { useRefreshAndWait } from "../shared/atom-runtime";
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
import {
  type MfaFailure,
  mfaFailureMessage,
  mfaStatusAtom,
  useActivateMfa,
  useEnrollMfa,
} from "./mfa-atom";
import { hasFailureTag } from "../shared/failure-message";
import { useMfaCodeEntry } from "./use-mfa-code-entry";

const CODE_INPUT_ID = "mfa-enroll-code";

type EnrollState =
  | { step: "starting" }
  | { step: "scan"; enrollment: MfaEnrollment }
  | { step: "verify"; enrollment: MfaEnrollment }
  | { step: "recoveryCodes"; recoveryCodes: readonly string[] }
  | { step: "failed"; message: string };

const failedStep = (cause: Cause.Cause<MfaFailure>): EnrollState => ({
  step: "failed",
  message: mfaFailureMessage(cause),
});

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

const ScanStep = ({ totpUri, onNext }: { totpUri: string; onNext: () => void }) => {
  const totpSecret = readTotpSecret(totpUri);
  return (
    <div className="space-y-4">
      <TotpQrCode totpUri={totpUri} />
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          認証アプリで QR コードを読み取ってください。読み取れない場合は、次の secret
          を手入力します。
        </p>
        <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-sm" translate="no">
          {totpSecret ?? "—"}
        </p>
        {totpSecret !== null && <CopyButton value={totpSecret} label="secret をコピー" />}
      </div>
      <DialogFooter>
        <Button onClick={onNext}>次へ</Button>
      </DialogFooter>
    </div>
  );
};

const RecoveryCodesStep = ({
  recoveryCodes,
  onClose,
}: {
  recoveryCodes: readonly string[];
  onClose: () => void;
}) => (
  <div className="space-y-4">
    <p className="text-sm text-destructive">
      このダイアログを閉じると再表示できません。認証アプリを使えなくなった時の唯一の
      ログイン手段なので、必ず控えてから閉じてください。
    </p>
    <ul className="grid grid-cols-2 gap-2 rounded-md bg-muted p-3" translate="no">
      {recoveryCodes.map((code) => (
        <li key={code} className="font-mono text-sm">
          {code}
        </li>
      ))}
    </ul>
    <CopyButton value={recoveryCodes.join("\n")} label="リカバリーコードをコピー" />
    <DialogFooter>
      <Button onClick={onClose}>控えたので閉じる</Button>
    </DialogFooter>
  </div>
);

type Props = {
  trigger: ReactNode;
};

export const MfaEnrollDialog = ({ trigger }: Props) => {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<EnrollState>({ step: "starting" });
  const [resumableEnrollment, setResumableEnrollment] = useState<MfaEnrollment | null>(null);
  const refreshStatus = useRefreshAndWait(mfaStatusAtom);
  const enrollMfa = useEnrollMfa();
  const activateMfa = useActivateMfa();

  const entry = useMfaCodeEntry({
    inputId: CODE_INPUT_ID,
    submit: ({ code }) => {
      if (state.step !== "verify") return Promise.resolve(null);
      const { enrollment } = state;
      return activateMfa({ code, enrollment_id: enrollment.enrollment_id }).then(
        Exit.match({
          onSuccess: () => {
            setResumableEnrollment(null);
            setState({ step: "recoveryCodes", recoveryCodes: enrollment.recovery_codes });
            return null;
          },
          onFailure: (cause) => {
            if (hasFailureTag(cause, "EnrollmentChanged")) setResumableEnrollment(null);
            return mfaFailureMessage(cause);
          },
        }),
      );
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (state.step === "starting" && open) return;
    if (entry.submitting) return;

    if (next) {
      entry.reset();
      setOpen(true);
      if (resumableEnrollment !== null) {
        setState({ step: "scan", enrollment: resumableEnrollment });
        return;
      }
      setState({ step: "starting" });
      void enrollMfa().then(
        Exit.match({
          onSuccess: (enrollment) => {
            setResumableEnrollment(enrollment);
            setState({ step: "scan", enrollment });
          },
          onFailure: (cause) => setState(failedStep(cause)),
        }),
      );
      return;
    }

    setOpen(false);
    if (state.step === "recoveryCodes") {
      void notifyAfterRefresh(refreshStatus, {
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
          <ScanStep
            totpUri={state.enrollment.totp_uri}
            onNext={() => setState({ step: "verify", enrollment: state.enrollment })}
          />
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
          <RecoveryCodesStep
            recoveryCodes={state.recoveryCodes}
            onClose={() => handleOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
};
