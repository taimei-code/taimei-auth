import { useState, type ChangeEvent, type ComponentPropsWithoutRef, type FormEvent } from "react";

import type { MfaCodeKind } from "./mfa-atom";
import { oneAtATime } from "./one-at-a-time";

const WHITESPACE = /\s+/g;
const PASTE_TOLERANT_MAX_LENGTH = 32;
const HYPHEN_LIKE = /[-‐-―−ー]/g;

export function normalizeMfaCode(raw: string, kind: MfaCodeKind): string {
  const halfWidth = raw.normalize("NFKC").replace(WHITESPACE, "");
  return kind === "totp" ? halfWidth.replace(HYPHEN_LIKE, "") : halfWidth.replace(HYPHEN_LIKE, "-");
}

export type MfaCodeInput = {
  kind: MfaCodeKind;
  toggleKind: () => void;
  toggleLabel: string;
  labelText: string;
  hint: string;
  hintId: string;
  errorId: string;
  errorMessage: string | null;
  submitting: boolean;
  canSubmit: boolean;
  inputProps: ComponentPropsWithoutRef<"input">;
  handleSubmit: (event: FormEvent) => void;
  reset: () => void;
};

export function useMfaCodeInput(options: {
  inputId: string;
  submitting: boolean;
  errorMessage: string | null;
  submit: (input: { code: string; kind: MfaCodeKind }) => void;
  onKindChange?: () => void;
}): MfaCodeInput {
  const [kind, setKind] = useState<MfaCodeKind>("totp");
  const [code, setCode] = useState("");

  const normalizedCode = normalizeMfaCode(code, kind);
  const isTotp = kind === "totp";
  const hintId = `${options.inputId}-hint`;
  const errorId = `${options.inputId}-error`;

  const toggleKind = () => {
    setKind(isTotp ? "recovery_code" : "totp");
    setCode("");
    options.onKindChange?.();
  };

  const reset = () => {
    setKind("totp");
    setCode("");
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (options.submitting || normalizedCode === "") return;
    options.submit({ code: normalizedCode, kind });
  };

  return {
    kind,
    toggleKind,
    toggleLabel: isTotp ? "リカバリーコードを使う" : "認証アプリの確認コードを使う",
    labelText: isTotp ? "確認コード" : "リカバリーコード",
    hint: isTotp
      ? "認証アプリに表示されている 6 桁の数字を入力してください。"
      : "有効化時に控えたリカバリーコードを 1 つ入力してください (1 つにつき 1 回だけ使えます)。",
    hintId,
    errorId,
    errorMessage: options.errorMessage,
    submitting: options.submitting,
    canSubmit: !options.submitting && normalizedCode !== "",
    inputProps: {
      id: options.inputId,
      value: code,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setCode(event.target.value),
      disabled: options.submitting,
      required: true,
      autoComplete: "one-time-code",
      inputMode: isTotp ? "numeric" : "text",
      autoCapitalize: "off",
      autoCorrect: "off",
      spellCheck: false,
      maxLength: PASTE_TOLERANT_MAX_LENGTH,
      placeholder: isTotp ? "123456" : "xxxxx-xxxxx",
      "aria-label": isTotp ? "確認コード" : "リカバリーコード",
      "aria-invalid": options.errorMessage !== null,
      "aria-describedby": options.errorMessage === null ? hintId : `${hintId} ${errorId}`,
    },
    handleSubmit,
    reset,
  };
}

export function useMfaCodeEntry(options: {
  inputId: string;
  submit: (input: { code: string; kind: MfaCodeKind }) => Promise<string | null>;
}): MfaCodeInput {
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [runOneAtATime] = useState(oneAtATime);

  const input = useMfaCodeInput({
    inputId: options.inputId,
    submitting,
    errorMessage,
    onKindChange: () => setErrorMessage(null),
    submit: (value) => {
      runOneAtATime(() => {
        setSubmitting(true);
        setErrorMessage(null);
        return options
          .submit(value)
          .then(setErrorMessage)
          .finally(() => setSubmitting(false));
      });
    },
  });

  return {
    ...input,
    reset: () => {
      input.reset();
      setErrorMessage(null);
      setSubmitting(false);
    },
  };
}
