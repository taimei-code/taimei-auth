import { AsyncLocalStorage } from "node:async_hooks";

// 背景タスク (audit log / welcome email 等) を runtime 横断で走らせる。Workers は response 後の未解決
// promise を "hung" として cancel するため ctx.waitUntil に登録し、ALS で per-request に伝播する (ADR-0011)。
type WaitUntil = (promise: Promise<unknown>) => void;

const waitUntilStore = new AsyncLocalStorage<WaitUntil>();

// worker entry が fetch 処理全体をこの中で走らせ、ctx.waitUntil を per-request に束縛する。
export function withWaitUntil<T>(waitUntil: WaitUntil, fn: () => T): T {
  return waitUntilStore.run(waitUntil, fn);
}

// promise は呼出側で生成・.catch 済みの前提。Workers は ctx.waitUntil で完走を保証し、Bun/Node は
// fire-and-forget (process 終了時の取りこぼしは監査ログが critical path でないため許容)。
export function runBackground(promise: Promise<unknown>): void {
  const waitUntil = waitUntilStore.getStore();
  if (waitUntil) waitUntil(promise);
}
