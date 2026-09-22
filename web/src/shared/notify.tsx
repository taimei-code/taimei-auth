import { lazy, Suspense, useEffect, type ComponentProps, type ComponentType } from "react";

type ToasterComponent = ComponentType<ComponentProps<typeof import("sonner").Toaster>>;

let toasterUnavailable = false;

// chunk の取得失敗を Suspense へ throw すると error boundary の無い /account ごと unmount される
const SonnerToaster = lazy<ToasterComponent>(() =>
  import("sonner")
    .then((m) => ({ default: m.Toaster }))
    .catch((e) => {
      toasterUnavailable = true;
      console.error("toaster chunk load failed", e);
      return { default: () => null };
    }),
);

// sonner の既定値と同じ。render ごとに新しい配列を渡すと keydown listener が再登録される
const TOASTER_HOTKEY = ["altKey", "KeyT"];

type Deferred = { promise: Promise<void>; resolve: () => void };
const deferred = (): Deferred => {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
let toasterMounted = deferred();

// 同じ commit で sonner の subscribe (useEffect) が先に走るため、この effect の時点で toast() は届く
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
        classNames: {
          error: "!border-destructive/40 !bg-destructive/10 !text-destructive",
        },
      }}
    />
    <ToasterMountedSignal />
  </Suspense>
);

const TOASTER_MOUNT_TIMEOUT_MS = 5_000;

// sonner の toast() は publish 時点で subscribe 済みの Toaster にしか届かない
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

// sonner には toast ごとの role=alert が無いので長い duration と closeButton で代替する。duration は sonner の既定値に依存しない
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

// staleShort は「〜が、…失敗しました」に繋げる節なので句点を付けない
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
