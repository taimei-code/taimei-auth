import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";

// 操作結果通知 (toast) の唯一の窓口。経路と sonner 制約の正本 — 他所からは参照 1 行に留める。
// - 画面レベルの操作結果 → notifySuccess / notifyError。再取得を伴う通知 → notifyAfterRefresh
// - dialog 内のエラー、UI 状態と対で残すエラー、role=alert の即時読み上げが要るエラーは inline のまま
// - 通知窓口は state 層 (account/current-company や *-api) を import しない (/auth/* に sonner を配らない分離が崩れる)
// - 遷移 (location.replace) を伴う成功通知は document ごと消えて届かない。Toaster の mount 先
//   (AccountLayout) が生き残る SPA 遷移 (navigate) なら届く — その場合は notifyAfterRefresh を使う
// - sonner に per-toast の role=alert は無く error も polite 読み上げ。長い duration + closeButton で代替する
// - 開いている Radix dialog の背面 (aria-hidden) への toast 挿入は読み上げられない

type ToasterComponent = ComponentType<ComponentProps<typeof import("sonner").Toaster>>;

let toasterUnavailable = false;

// sonner の静的 import は CSS 14.9KB + JS 9.3KB gzip を entry chunk に載せるため動的 import で /auth/* から外す。
// chunk 取得失敗は throw を Suspense へ流さず (error boundary の無い /account が丸ごと unmount する) console.error だけ残す。
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
        // error だけ inline エラーと同じ視覚言語に寄せる (success は無彩色のまま)
        classNames: {
          error: "!border-destructive/40 !bg-destructive/10 !text-destructive",
        },
      }}
    />
  </Suspense>
);

// duration は library default に委ねず明示する (依存更新で通知の寿命が silent に変わるのを防ぐ)。
// toasterUnavailable の先読みは「import は成功するが Toaster が死んでいる」穴を塞ぐ (toast が無反応になる)。
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

// 再取得 (GET) の失敗を mutation 側の catch に流すと嘘の失敗理由が出るため「成功したが表示が古い」文言に落とす。
// この Promise は reject しない。staleShort は接尾辞に繋ぐ節 (末尾「。」無し)、done 省略時は成功を無通知にする。
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
