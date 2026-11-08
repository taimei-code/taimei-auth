import { useState, type ChangeEvent, type ComponentPropsWithoutRef, type FormEvent } from "react";

import type { MfaCodeKind } from "./mfa-atom";
import {
  MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
  MFA_CODE_TEXTS,
  normalizeMfaCode,
  otherMfaCodeKind,
} from "./mfa-code";
import { oneAtATime } from "./one-at-a-time";

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
  const texts = MFA_CODE_TEXTS[kind];
  const hintId = `${options.inputId}-hint`;
  const errorId = `${options.inputId}-error`;

  const toggleKind = () => {
    setKind(otherMfaCodeKind);
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
    toggleLabel: texts.toggleLabel,
    labelText: texts.label,
    hint: texts.hint,
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
      inputMode: texts.inputMode,
      autoCapitalize: "off",
      autoCorrect: "off",
      spellCheck: false,
      maxLength: MFA_CODE_PASTE_TOLERANT_MAX_LENGTH,
      placeholder: texts.placeholder,
      "aria-label": texts.label,
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
