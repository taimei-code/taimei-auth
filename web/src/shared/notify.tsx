import { lazy, Suspense, useEffect, type ComponentProps, type ComponentType } from "react";

// 操作結果通知 (toast) の唯一の窓口。経路と sonner 制約の正本 — 他所からは参照 1 行に留める。
// - 画面レベルの操作結果 → notifySuccess / notifyError。再取得を伴う通知 → notifyAfterRefresh
// - dialog 内のエラー、UI 状態と対で残すエラー、role=alert の即時読み上げが要るエラーは inline のまま
// - 通知窓口は state 層 (account/current-company や *-api) を import しない (/auth/* に sonner を配らない分離が崩れる)
// - 遷移 (location.replace) を伴う成功通知は document ごと消えて届かない。Toaster の mount 先
//   (AccountLayout) が生き残る SPA 遷移 (navigate) なら届く — その場合は notifyAfterRefresh を使う
// - sonner の toast() は publish 時点で subscribe 済みの Toaster にしか届かず、後から mount した Toaster には
//   再送されない。Toaster は lazy chunk の解決後に mount するため、発行側は mount (toasterMounted) を待つ
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

// Toaster の mount を発行側に知らせる Promise。full load 直後 (lazy chunk 解決前) に出した通知が捨てられないよう、
// notify* は import("sonner") と並んでこれを待つ。unmount で pending に戻す (次の mount まで待たせる)。
type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let toasterMounted = deferred();

// Suspense の中で SonnerToaster の後ろに置く。同じ commit で sonner の subscribe (useEffect) が先に走り、
// この effect が resolve した時点では toast() が届く状態になっている。
const ToasterMountedSignal = () => {
  useEffect(() => {
    toasterMounted.resolve();
    return () => {
      toasterMounted = deferred();
    };
  }, []);
  return null;
};

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
    <ToasterMountedSignal />
  </Suspense>
);

// Toaster が mount しないまま (chunk 失敗や /account 外) 待ち続けないための上限。超えたら console にだけ残す。
const TOASTER_MOUNT_TIMEOUT_MS = 5_000;

const withToast = (): Promise<typeof import("sonner")["toast"]> =>
  Promise.all([
    import("sonner"),
    Promise.race([
      toasterMounted.promise,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("toaster not mounted")), TOASTER_MOUNT_TIMEOUT_MS);
      }),
    ]),
  ]).then(([m]) => m.toast);

// duration は library default に委ねず明示する (依存更新で通知の寿命が silent に変わるのを防ぐ)。
// toasterUnavailable の先読みは「import は成功するが Toaster が死んでいる」穴を塞ぐ (toast が無反応になる)。
export const notifySuccess = (text: string): void => {
  if (toasterUnavailable) {
    console.error(text);
    return;
  }
  void withToast()
    .then((toast) => toast.success(text, { duration: 4_000 }))
    .catch((e) => console.error(text, e));
};

export const notifyError = (text: string): void => {
  if (toasterUnavailable) {
    console.error(text);
    return;
  }
  void withToast()
    .then((toast) => toast.error(text, { duration: 10_000, closeButton: true }))
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
