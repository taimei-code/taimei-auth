import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";

// 操作結果通知 (toast) の唯一の窓口。経路の規則:
// - 画面レベルの操作結果 (保存・変更・削除・招待の成否) → notifySuccess / notifyError
// - dialog 内のエラー (AddCompanyDialog / TransferOwnershipModal)、UI 状態と対で残す必要が
//   あるエラー (Companies のオーナー委譲導線の理由説明)、role=alert の即時読み上げを保ちたい
//   エラー (DangerZone の退会失敗) → 従来どおり inline 表示
// - mutation 成功後の再取得を伴う通知 → notifyAfterRefresh。フローヘルパーはコールバック注入
//   のみ受け取り、company-context / account-api をここから import しない (通知窓口が画面の
//   state 層に依存すると /auth/* に sonner を配らない分離が崩れる)
// 制約 (sonner / ブラウザ由来。この記述が正本 — 他所からは参照 1 行に留める):
// - 遷移 (location.replace / redirect) を伴う操作の成功通知は document ごと消えるため toast では届かない
// - sonner は per-toast の role=alert (assertive) を持たず、error も polite 読み上げになる。
//   即時性の代わりに長い duration + closeButton で対処を読み終えるまで残す
// - 開いている Radix dialog の背面 (aria-hidden) への toast 挿入は読み上げられない。移行前の
//   画面内 state 描画でも同条件で、toast は dialog が閉じた後も表示が残る分だけ視覚的には改善

type ToasterComponent = ComponentType<ComponentProps<typeof import("sonner").Toaster>>;

let toasterUnavailable = false;

// sonner は静的 import しない: import 時に CSS 14.9KB を注入し JS +9.3KB gzip が entry chunk に
// 乗るため、toast を使わない /auth/* (サインイン初期表示) に配らないよう動的 import で分離する。
// chunk 取得失敗 (デプロイ直後の旧 chunk 消失等) では通知を諦めて描画を続ける。Suspense へ
// throw を素通しすると error boundary の無い /account ツリーが丸ごと unmount する。lazy は
// 一度失敗すると再試行せず以後の全通知が消えるため、console.error で唯一の痕跡を残す
const SonnerToaster = lazy<ToasterComponent>(() =>
  import("sonner")
    .then((m) => ({ default: m.Toaster }))
    .catch((e) => {
      toasterUnavailable = true;
      console.error("toaster chunk load failed", e);
      return { default: () => null };
    }),
);

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

// duration は library default に委ねず明示する (依存更新で通知の寿命が silent に変わるのを防ぐ)。
// 呼び出し側は通知を唯一の痕跡として console.error を持たないため、sonner 自体を読めなかった
// 場合の痕跡はこの 2 箇所の catch で担保する (ブラウザ側に error reporting は無い)。
// toasterUnavailable の先読みは「import は成功するが Toaster が死んでいる」穴を塞ぐ: mount 時に
// chunk 取得が転ぶと lazy は以後 null 固定になり、toast は表示先の無い store に積まれて無反応になる
export const notifySuccess = (text: string): void => {
  if (toasterUnavailable) {
    console.error(text);
    return;
  }
  void import("sonner")
    .then(({ toast }) => toast.success(text, { duration: 4_000 }))
    .catch((e) => console.error(text, e));
};

export const notifyError = (text: string): void => {
  if (toasterUnavailable) {
    console.error(text);
    return;
  }
  void import("sonner")
    .then(({ toast }) => toast.error(text, { duration: 10_000, closeButton: true }))
    .catch((e) => console.error(text, e));
};

// mutation 成功後の再取得と結果通知。再取得 (GET) の失敗を mutation 側の catch
// (変更 API 専用の文言表) に流すと「権限がありません」等の嘘の失敗理由が出るため、
// ここで「成功したが表示が古い」専用の文言に落とす (接尾辞は一覧画面・設定フォームの
// どちらでも成り立つ「表示の更新」に揃える)。呼び出し側の catch を汚さないよう成功・stale
// いずれも通知で完結させ、この Promise は reject しない (refresh を then 経由で呼ぶのは
// 同期 throw も stale 側へ落とすため — 直接呼びに戻すと呼び出し側へ素通しする)。
// staleShort は接尾辞に繋ぐ節の幹 (末尾「。」無し) を呼び出し側が必ず渡す — 成功文言から
// 機械的に導出すると複数文の done で文が壊れるため。done は成功が画面の変化自体で伝わる
// 操作 (事業所切替) では省略し、その場合の成功は無通知にする
export const notifyAfterRefresh = (
  refresh: () => Promise<unknown>,
  text: { done?: string; staleShort: string },
): Promise<void> =>
  Promise.resolve()
    .then(refresh)
    .then(() => {
      if (text.done) notifySuccess(text.done);
    })
    .catch(() =>
      notifyError(
        `${text.staleShort}が、表示の更新に失敗しました。ページを再読み込みしてください。`,
      ),
    );
