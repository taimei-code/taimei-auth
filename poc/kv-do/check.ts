// 使い方: bunx wrangler dev -c poc/kv-do/wrangler.jsonc --port 8799 を起動してから bun run poc/kv-do/check.ts
const base = process.env.POC_BASE ?? "http://127.0.0.1:8799";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const call = async (path: string, q: Record<string, string | number>) => {
  const url = new URL(path, base);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, String(v));
  return (await fetch(url)).json() as Promise<Record<string, unknown>>;
};
const results: Array<[string, boolean, unknown]> = [];
const check = (name: string, ok: boolean, observed: unknown) => results.push([name, ok, observed]);
const run = String(Date.now());

// get / set / delete
check("get 未設定 → null", (await call("/get", { k: `${run}:a` })).v === null, null);
await call("/set", { k: `${run}:a`, v: "hello" });
check("set → get", (await call("/get", { k: `${run}:a` })).v === "hello", "hello");
await call("/del", { k: `${run}:a` });
check("delete → get null", (await call("/get", { k: `${run}:a` })).v === null, null);

// (a) TTL 1 秒経過で消える (alarm)
await call("/set", { k: `${run}:ttl`, v: "x", n: 1 });
const before = (await call("/get", { k: `${run}:ttl` })).v;
await sleep(1500);
const after = (await call("/get", { k: `${run}:ttl` })).v;
check("TTL 内 get = x / 1.5s 後 get = null", before === "x" && after === null, { before, after });

// (b) 並行 getAndDelete 10 本で値を得るのは 1 本
await call("/set", { k: `${run}:once`, v: "token" });
const winners = (
  await Promise.all(Array.from({ length: 10 }, () => call("/getdel", { k: `${run}:once` })))
).filter((r) => r.v === "token").length;
check("並行 getAndDelete 10 本 → 取得 1 本", winners === 1, winners);

// (c) incrementWindow が 1,2,3 と増え window 2 秒経過で 1 に戻る
const c1 = (await call("/incr", { k: `${run}:w`, n: 2 })).count;
const c2 = (await call("/incr", { k: `${run}:w`, n: 2 })).count;
const c3 = (await call("/incr", { k: `${run}:w`, n: 2 })).count;
await sleep(2500);
const c4 = (await call("/incr", { k: `${run}:w`, n: 2 })).count;
check("incr 1,2,3 → 2.5s 後 1", c1 === 1 && c2 === 2 && c3 === 3 && c4 === 1, [c1, c2, c3, c4]);

// (d) 並行 incr 20 本が欠落なく 20 に達する
await Promise.all(Array.from({ length: 20 }, () => call("/incr", { k: `${run}:par`, n: 60 })));
const parCount = (await call("/incr", { k: `${run}:par`, n: 60 })).count;
check("並行 incr 20 本 → 次は 21", parCount === 21, parCount);

for (const [name, ok, observed] of results) console.log(ok ? "PASS" : "FAIL", name, JSON.stringify(observed));
if (results.some(([, ok]) => !ok)) process.exit(1);
export {};
