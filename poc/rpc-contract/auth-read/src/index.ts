import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client/cookie";
import { Exit, Schema } from "effect";
import { CookieHeader, GetSessionResult } from "../../../../src/rpc/consumer-rpc-contract";

type Snapshot = typeof GetSessionResult.Encoded;

type Env = {
  SNAPSHOTS: DurableObjectNamespace<SessionSnapshot>;
  READ_MODEL: DurableObjectNamespace<ReadModel>;
  AUTH_CORE: { getSession(cookieHeader: string): Promise<Snapshot> };
};

const SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;

type ReadOutcome = { readonly hit: Snapshot } | { readonly miss: number };

export class ReadModel extends DurableObject {
  private failInvalidations = false;

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "create table if not exists snap (token_hash text primary key, filled_epoch integer not null, filled_at integer not null, body text not null)",
    );
    ctx.storage.sql.exec("create table if not exists meta (k text primary key, v integer not null)");
  }

  private epoch(): number {
    const row = this.ctx.storage.sql.exec<{ v: number }>("select v from meta where k = 'epoch'").toArray()[0];
    return row ? Number(row.v) : 0;
  }

  read(tokenHash: string, now: number): ReadOutcome {
    const epoch = this.epoch();
    const row = this.ctx.storage.sql
      .exec<{ filled_epoch: number; filled_at: number; body: string }>(
        "select filled_epoch, filled_at, body from snap where token_hash = ?",
        tokenHash,
      )
      .toArray()[0];
    if (!row || Number(row.filled_epoch) !== epoch || now - Number(row.filled_at) >= SNAPSHOT_MAX_AGE_MS) {
      return { miss: epoch };
    }
    const body = JSON.parse(row.body) as Snapshot;
    if (body._tag !== "Verified" || Date.parse(body.session.expiresAt) <= now) return { miss: epoch };
    return { hit: body };
  }

  fill(tokenHash: string, startedAtEpoch: number, body: Snapshot, now: number): "filled" | "rejected" {
    if (this.epoch() !== startedAtEpoch) return "rejected";
    this.ctx.storage.sql.exec(
      "insert into snap (token_hash, filled_epoch, filled_at, body) values (?, ?, ?, ?) on conflict (token_hash) do update set filled_epoch = excluded.filled_epoch, filled_at = excluded.filled_at, body = excluded.body",
      tokenHash,
      startedAtEpoch,
      now,
      JSON.stringify(body),
    );
    return "filled";
  }

  invalidateAll(): number {
    if (this.failInvalidations) throw new Error("read model invalidation failed (poc switch)");
    const next = this.epoch() + 1;
    this.ctx.storage.sql.exec(
      "insert into meta (k, v) values ('epoch', ?) on conflict (k) do update set v = excluded.v",
      next,
    );
    return next;
  }

  setFailInvalidations(value: boolean): void {
    this.failInvalidations = value;
  }
}

export class SessionSnapshot extends DurableObject {
  async read(): Promise<Snapshot | null> {
    return (await this.ctx.storage.get<Snapshot>("snapshot")) ?? null;
  }

  async write(snapshot: Snapshot): Promise<void> {
    await this.ctx.storage.put("snapshot", snapshot);
  }
}

const decodeCookieHeader = Schema.decodeUnknownExit(CookieHeader);
const encodeResult = Schema.encodeSync(GetSessionResult);
const decodeResult = Schema.decodeUnknownSync(GetSessionResult);

const snapshotKey = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
};

export class ReadRpc extends WorkerEntrypoint<Env> {
  async getSession(cookieHeader: unknown): Promise<Snapshot> {
    const decoded = decodeCookieHeader(cookieHeader);
    if (Exit.isFailure(decoded)) return { _tag: "InvalidInput" };
    const token = extractSessionTokenFromCookieHeader(decoded.value);
    if (!token) return { _tag: "Rejected", reason: "SESSION_NOT_FOUND" };
    const stub = this.env.SNAPSHOTS.get(this.env.SNAPSHOTS.idFromName(await snapshotKey(token)));
    const snapshot = await stub.read();
    if (!snapshot) return { _tag: "Rejected", reason: "SESSION_NOT_FOUND" };
    return encodeResult(decodeResult(snapshot));
  }

  async seed(cookieHeader: string, snapshot: Snapshot): Promise<void> {
    const token = extractSessionTokenFromCookieHeader(cookieHeader);
    if (!token) throw new Error("no session cookie");
    const stub = this.env.SNAPSHOTS.get(this.env.SNAPSHOTS.idFromName(await snapshotKey(token)));
    await stub.write(snapshot);
  }
}

const readModel = (env: Env) => env.READ_MODEL.get(env.READ_MODEL.idFromName("global"));

export class EdgeRpc extends WorkerEntrypoint<Env> {
  async getSession(cookieHeader: unknown, nowOffsetMs = 0) {
    const decoded = decodeCookieHeader(cookieHeader);
    if (Exit.isFailure(decoded)) return { source: "invalid" as const, result: { _tag: "InvalidInput" as const } };
    const token = extractSessionTokenFromCookieHeader(decoded.value);
    if (!token) {
      return { source: "no-cookie" as const, result: { _tag: "Rejected" as const, reason: "SESSION_NOT_FOUND" as const } };
    }
    const tokenHash = await snapshotKey(token);
    const now = Date.now() + nowOffsetMs;
    const model = readModel(this.env);
    const outcome = await model.read(tokenHash, now);
    if ("hit" in outcome) return { source: "hit" as const, result: encodeResult(decodeResult(outcome.hit)) };
    const result = encodeResult(decodeResult(await this.env.AUTH_CORE.getSession(decoded.value)));
    const filled = result._tag === "Verified" ? await model.fill(tokenHash, outcome.miss, result, Date.now()) : "not-cached";
    return { source: "miss" as const, filled, result };
  }

  async invalidateAll() {
    return readModel(this.env).invalidateAll();
  }

  async setFailInvalidations(value: boolean) {
    return readModel(this.env).setFailInvalidations(value);
  }

  async beginFill(cookieHeader: string) {
    const token = extractSessionTokenFromCookieHeader(cookieHeader) ?? "";
    const outcome = await readModel(this.env).read(await snapshotKey(token), Number.MAX_SAFE_INTEGER);
    const startedAtEpoch = "miss" in outcome ? outcome.miss : -1;
    return { startedAtEpoch, snapshot: await this.env.AUTH_CORE.getSession(cookieHeader) };
  }

  async fill(cookieHeader: string, startedAtEpoch: number, snapshot: Snapshot) {
    const token = extractSessionTokenFromCookieHeader(cookieHeader) ?? "";
    return readModel(this.env).fill(await snapshotKey(token), startedAtEpoch, snapshot, Date.now());
  }
}

export default {
  fetch: () => new Response("not found", { status: 404 }),
};
