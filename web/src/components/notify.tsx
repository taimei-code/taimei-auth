import { lazy, Suspense } from "react";

// 操作結果通知 (toast) の唯一の窓口。経路の規則:
// - 画面レベルの操作結果 (保存・変更・削除・招待の成否) → notifySuccess / notifyError
// - dialog 内のエラー (AddCompanyDialog / TransferOwnershipModal)、UI 状態と対で残す必要が
//   あるエラー (Companies のオーナー委譲導線の理由説明)、role=alert の即時読み上げを保ちたい
//   エラー (DangerZone の退会失敗) → 従来どおり inline 表示
// 制約 (sonner / ブラウザ由来。この記述が正本 — 他所からは参照 1 行に留める):
// - 遷移 (location.replace / redirect) を伴う操作の成功通知は document ごと消えるため toast では届かない
// - sonner は per-toast の role=alert (assertive) を持たず、error も polite 読み上げになる。
//   即時性の代わりに長い duration + closeButton で対処を読み終えるまで残す
// - 開いている Radix dialog の背面 (aria-hidden) への toast 挿入は読み上げられない。移行前の
//   画面内 state 描画でも同条件で、toast は dialog が閉じた後も表示が残る分だけ視覚的には改善
//
// sonner は静的 import しない: import 時に CSS 14.9KB を注入し JS +9.3KB gzip が entry chunk に
// 乗るため、toast を使わない /auth/* (サインイン初期表示) に配らないよう動的 import で分離する。
const SonnerToaster = lazy(() => import("sonner").then((m) => ({ default: m.Toaster })));

// sonner 既定値と同値だが、render ごとに新しい配列を渡すと keydown listener が再登録されるため固定する
const TOASTER_HOTKEY = ["altKey", "KeyT"];

export const Toaster = () => (
  <Suspense fallback={null}>
    <SonnerToaster
      position="bottom-right"
      hotkey={TOASTER_HOTKEY}
      toastOptions={{
        // error だけ inline エラー (text-destructive 系) と同じ視覚言語に寄せる。success は
        // 無彩色のまま (palette に success 色を増やさない方針は据え置き)
        classNames: {
          error: "!border-destructive/40 !bg-destructive/10 !text-destructive",
        },
      }}
    />
  </Suspense>
);

// duration は library default に委ねず明示する (依存更新で通知の寿命が silent に変わるのを防ぐ)
export const notifySuccess = (text: string): void => {
  void import("sonner").then(({ toast }) => toast.success(text, { duration: 4_000 }));
};

export const notifyError = (text: string): void => {
  void import("sonner").then(({ toast }) =>
    toast.error(text, { duration: 10_000, closeButton: true }),
  );
};
