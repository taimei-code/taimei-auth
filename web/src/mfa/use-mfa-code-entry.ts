import {
  useRef,
  useState,
  type ChangeEvent,
  type ComponentPropsWithoutRef,
  type FormEvent,
} from "react";

// 純関数を bun test (cwd = repo root) から読むため相対 import にする (理由: web/tsconfig.json の paths コメント)。
import { mfaErrorCodeOf, type MfaCodeKind, type MfaErrorCode } from "./mfa-api";

// 第二要素のコード入力を持つ 3 画面が共有する入力機構。正規化・入力支援属性・エラー文言を各画面に散らすと
// 片方だけ直る (use-sign-page.ts と同じ規律)。非同期処理は options の所有者、文言・レイアウトは JSX が持つ。

const WHITESPACE = /\s+/g;
// NFKC が ASCII に畳まないダッシュ類 (U+2010〜U+2015 / 負符号 / 長音記号)。メール本文からの貼り付けで混ざる。
const HYPHEN_LIKE = /[-‐-―−ー]/g;

// kind 必須の理由: ハイフンの扱いが種別で逆になる。認証アプリの 6 桁では飾りだが、リカバリーコードの
// ハイフンは server 側の完全一致比較 (better-auth の backupCodes.includes) の一部で、落とすと必ず不一致。
export function normalizeMfaCode(raw: string, kind: MfaCodeKind): string {
  const halfWidth = raw.normalize("NFKC").replace(WHITESPACE, "");
  return kind === "totp" ? halfWidth.replace(HYPHEN_LIKE, "") : halfWidth.replace(HYPHEN_LIKE, "-");
}

const GENERIC_MESSAGE = "処理に失敗しました。しばらく待ってからもう一度お試しください。";

// invalid_code に「もう一度お試しください」を書かないのは、server が試行上限超過も同コードへ写像するため
// (src/mfa/error-mapping.ts)。チャレンジは既に破棄済みで、再試行を促すと袋小路へ案内することになる。
const MESSAGE_BY_ERROR_CODE: Record<MfaErrorCode, string> = {
  invalid_code: "入力されたコードが正しくありません。",
  challenge_expired: "ログインの有効期限が切れました。お手数ですが、もう一度ログインしてください。",
  locked: "試行回数の上限に達しました。15 分ほど経ってからやり直してください。",
  rate_limited: "操作の回数が上限に達しました。しばらく待ってからもう一度お試しください。",
  already_enabled: "多要素認証 (MFA) はすでに有効です。ページを再読み込みしてください。",
  enrollment_changed: "登録情報が更新されました。もう一度登録を開始してください。",
  temporarily_unavailable:
    "別の多要素認証 (MFA) 操作を処理中です。しばらく待ってからやり直してください。",
  not_enabled: "多要素認証 (MFA) は有効になっていません。ページを再読み込みしてください。",
  invalid_argument: "コードの形式が正しくありません。",
  unauthorized: "ログイン状態が確認できませんでした。もう一度ログインしてください。",
  not_found: GENERIC_MESSAGE,
  unknown: GENERIC_MESSAGE,
};

// server / 通信由来の外部入力キーでの lookup。prototype チェーン上のメンバー ("toString" 等) は
// undefined にならず既定文言への縮退を素通りするため、hasOwn を先に挟む。
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

  // 入力 (kind / code) だけを初期化する。errorCode は所有者側が併せて消す — 消し忘れると失敗文言と
  // 初期化後の入力欄が並び、打ち直せば通るように読める (useMfaCodeEntry の reset が実例)。
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
      // one-time-code はモバイル OS の補完の合図。inputMode を種別で変えるのはリカバリーコードが英数混在のため。
      autoComplete: "one-time-code",
      inputMode: isTotp ? "numeric" : "text",
      // リカバリーコードは大文字小文字まで含めて照合されるため IME の自動整形を全て切る。
      autoCapitalize: "off",
      autoCorrect: "off",
      spellCheck: false,
      // 貼り付けを途中で切らない上限 (全角・区切り入りでも収まる)。桁数の正否は server が決める。
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
  // submitting state の反映は同期でないため、同一 task 内の二重 submit を state だけでは弾けない。POST を
  // 一回に保つ同期 guard は ref が持つ (use-mfa-challenge-flow.ts の verificationInFlight と同じ規律)。
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
