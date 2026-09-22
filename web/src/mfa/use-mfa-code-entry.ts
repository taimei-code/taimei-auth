import {
  useRef,
  useState,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type FormEvent,
} from "react";

import { mfaErrorCodeOf, type MfaCodeKind, type MfaErrorCode } from "./mfa-api";

const WHITESPACE = /\s+/g;
// NFKC で ASCII に正規化されないダッシュ類。メール本文からの貼り付けで混ざる。
const HYPHEN_LIKE = /[-‐-―−ー]/g;

// ハイフンは 6 桁のコードでは飾りだが、リカバリーコードでは server の完全一致照合の一部なので、落とすと必ず不一致になる。
export function normalizeMfaCode(raw: string, kind: MfaCodeKind): string {
  const halfWidth = raw.normalize("NFKC").replace(WHITESPACE, "");
  return kind === "totp" ? halfWidth.replace(HYPHEN_LIKE, "") : halfWidth.replace(HYPHEN_LIKE, "-");
}

const GENERIC_MESSAGE = "処理に失敗しました。しばらく待ってからもう一度お試しください。";

// invalid_code で再試行を促さないのは、server が試行上限の超過 (チャレンジ破棄済み) も同じコードで返すため。
const MESSAGE_BY_ERROR_CODE: Record<MfaErrorCode, string> = {
  invalid_code: "入力されたコードが正しくありません。",
  challenge_expired: "ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。",
  locked: "試行回数の上限に達しました。15 分ほど経ってからやり直してください。",
  rate_limited: "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
  already_enabled: "多要素認証 (MFA) はすでに有効です。ページを再読み込みしてください。",
  enrollment_changed: "登録情報が更新されました。もう一度登録を開始してください。",
  not_enabled: "多要素認証 (MFA) は有効になっていません。ページを再読み込みしてください。",
  invalid_argument: "コードの形式が正しくありません。",
  unauthorized: "ログイン状態が確認できませんでした。もう一度ログインしてください。",
  not_found: GENERIC_MESSAGE,
  unknown: GENERIC_MESSAGE,
};

export function describeMfaChallengeError(code: string): string {
  return Object.hasOwn(MESSAGE_BY_ERROR_CODE, code)
    ? MESSAGE_BY_ERROR_CODE[code as MfaErrorCode]
    : GENERIC_MESSAGE;
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
  errorCode: MfaErrorCode | null;
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
    errorMessage: options.errorCode === null ? null : describeMfaChallengeError(options.errorCode),
    submitting: options.submitting,
    canSubmit: !options.submitting && normalizedCode !== "",
    inputProps: {
      id: options.inputId,
      value: code,
      onChange: (event: ChangeEvent<HTMLInputElement>) => setCode(event.target.value),
      disabled: options.submitting,
      required: true,
      // one-time-code はモバイル OS に補完を促す指定。inputMode は英数混在のリカバリーコードでは変える。
      autoComplete: "one-time-code",
      inputMode: isTotp ? "numeric" : "text",
      // リカバリーコードは大文字小文字まで含めて照合されるため、IME の自動整形を全て切る。
      autoCapitalize: "off",
      autoCorrect: "off",
      spellCheck: false,
      // 貼り付けを途中で切らない上限 (全角や区切り入りでも収まる)。桁数の正否は server が判定する。
      maxLength: 32,
      placeholder: isTotp ? "123456" : "xxxxx-xxxxx",
      "aria-label": isTotp ? "確認コード" : "リカバリーコード",
      "aria-invalid": options.errorCode !== null,
      "aria-describedby": options.errorCode === null ? hintId : `${hintId} ${errorId}`,
    },
    handleSubmit,
    reset,
  };
}

export function useMfaCodeEntry(options: {
  inputId: string;
  submit: (input: { code: string; kind: MfaCodeKind }) => Promise<unknown>;
}): MfaCodeInput {
  const [submitting, setSubmitting] = useState(false);
  const [errorCode, setErrorCode] = useState<MfaErrorCode | null>(null);
  // submitting state の反映は同期ではないため、同じ task 内の二重 submit は ref でしか防げない。
  const submitInFlight = useRef(false);

  const input = useMfaCodeInput({
    inputId: options.inputId,
    submitting,
    errorCode,
    onKindChange: () => setErrorCode(null),
    submit: (value) => {
      if (submitInFlight.current) return;
      submitInFlight.current = true;
      setSubmitting(true);
      setErrorCode(null);
      void options
        .submit(value)
        .catch((error: unknown) => setErrorCode(mfaErrorCodeOf(error)))
        .finally(() => {
          submitInFlight.current = false;
          setSubmitting(false);
        });
    },
  });

  return {
    ...input,
    reset: () => {
      input.reset();
      setErrorCode(null);
      setSubmitting(false);
    },
  };
}
