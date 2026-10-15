import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { extractSessionTokenFromCookieHeader } from "@taimei-code/auth-client/cookie";
import { Exit, Schema } from "effect";
import { CookieHeader, GetSessionResult } from "../../../../src/rpc/consumer-rpc-contract";

type Snapshot = typeof GetSessionResult.Encoded;

type Env = { SNAPSHOTS: DurableObjectNamespace<SessionSnapshot> };

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

export default {
  fetch: () => new Response("not found", { status: 404 }),
};
