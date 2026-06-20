import { AsyncLocalStorage } from "node:async_hooks";

// 背景タスク (audit log / welcome email 等の fire-and-forget) を runtime 横断で安全に走らせる。
// Bun/Node: process が生き続けるため fire-and-forget で問題ない。
// Workers (workerd): response 後に未解決 promise が残ると runtime が "hung" として request を
// cancel するため、ctx.waitUntil に登録して response 後も完走させる必要がある。
// ctx は深い呼出 (better-auth hook 等) まで引き回せないので AsyncLocalStorage で per-request に伝播する。
// 設計詳細: docs/adr/0011-cloudflare-workers-migration.md
type WaitUntil = (promise: Promise<unknown>) => void;

const waitUntilStore = new AsyncLocalStorage<WaitUntil>();

// worker entry が fetch 処理全体をこの中で走らせ、ctx.waitUntil を per-request に束縛する。
export function withWaitUntil<T>(waitUntil: WaitUntil, fn: () => T): T {
  return waitUntilStore.run(waitUntil, fn);
}

// 背景タスクを登録する。promise は呼出側で生成・.catch 済みの前提。
// Workers では waitUntil に渡して完走を保証、Bun/Node では fire-and-forget のまま。
export function runBackground(promise: Promise<unknown>): void {
  const waitUntil = waitUntilStore.getStore();
  // Workers: ctx.waitUntil で response 後も完走を保証する。
  // Bun/Node: store 無し → fire-and-forget (best-effort。process 終了時は取りこぼしうるが、
  // 監査ログ等は critical path ではないため許容。呼出側で .catch 済み)。
  if (waitUntil) waitUntil(promise);
}
