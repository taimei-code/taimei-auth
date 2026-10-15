import { createRequire } from "node:module";

const [port, triggerUrl, perRunCount, wsModulePath] = process.argv.slice(2);
const WebSocketClient = createRequire(import.meta.url)(wsModulePath);
const count = Number(perRunCount);

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = targets.find((t) => t.webSocketDebuggerUrl);
if (!target) throw new Error(`no inspector target on ${port}: ${JSON.stringify(targets)}`);

const ws = new WebSocketClient(target.webSocketDebuggerUrl, {
  headers: { Origin: "https://devtools.devprod.cloudflare.dev" },
});
await new Promise((resolve, reject) => {
  ws.on("open", resolve);
  ws.on("error", reject);
});

let nextId = 1;
const pending = new Map();
ws.on("message", (data) => {
  const message = JSON.parse(String(data));
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

const summarize = (profile) => {
  const nameOf = new Map(profile.nodes.map((n) => [n.id, n.callFrame.functionName]));
  const deltas = [...profile.timeDeltas.slice(1), 0];
  let nonIdle = 0;
  let script = 0;
  profile.samples.forEach((sample, i) => {
    const name = nameOf.get(sample);
    if (name === "(idle)") return;
    nonIdle += deltas[i];
    if (name !== "(program)" && name !== "(garbage collector)") script += deltas[i];
  });
  if (process.env.TOP) {
    const urlOf = new Map(profile.nodes.map((n) => [n.id, `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/")}:${n.callFrame.lineNumber}`]));
    const self = new Map();
    profile.samples.forEach((sample, i) => self.set(urlOf.get(sample), (self.get(urlOf.get(sample)) ?? 0) + deltas[i]));
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(process.env.TOP));
    console.error(top.map(([k, v]) => `${(v / 1000).toFixed(1)}ms ${k}`).join("\n"));
  }
  if (process.env.CHAIN) {
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
    const nodeById = new Map(profile.nodes.map((n) => [n.id, n]));
    const chains = new Map();
    profile.samples.forEach((sample, i) => {
      if (nodeById.get(sample).callFrame.functionName !== process.env.CHAIN) return;
      const names = [];
      for (let id = parent.get(sample); id && names.length < 12; id = parent.get(id)) names.push(nodeById.get(id).callFrame.functionName || "(anon)");
      const key = names.join(" < ");
      chains.set(key, (chains.get(key) ?? 0) + deltas[i]);
    });
    console.error([...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${(v / 1000).toFixed(1)}ms ${k}`).join("\n"));
  }
  return { nonIdleMs: nonIdle / 1000, scriptMs: script / 1000 };
};

await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 100 });

const runs = [];
for (let run = 0; run < 3; run++) {
  await send("Profiler.start");
  const response = await fetch(triggerUrl);
  const body = await response.text();
  const { result } = await send("Profiler.stop");
  const { nonIdleMs, scriptMs } = summarize(result.profile);
  runs.push({
    nonIdlePerCallMs: +(nonIdleMs / count).toFixed(3),
    scriptPerCallMs: +(scriptMs / count).toFixed(3),
    status: response.status,
    body: body.slice(0, 120),
  });
}
const median = (values) => values.toSorted((a, b) => a - b)[1];
console.log(
  JSON.stringify({
    runs,
    medianNonIdlePerCallMs: median(runs.map((r) => r.nonIdlePerCallMs)),
    medianScriptPerCallMs: median(runs.map((r) => r.scriptPerCallMs)),
  }),
);
ws.close();
