import { Layer } from "effect";
import type { Hono } from "hono";
import { generatePasskeyId, insertPasskey } from "../../db/repositories/passkey";
import { testKvStore, testTtlStore } from "../../src/__tests__/test-ttl-store";
import { buildAppWith } from "../../src/handlers/__tests__/helpers";
import { signedIn, signedOut } from "../../src/membership/__tests__/test-layers";
import { ttlStoreLayer } from "../../src/ttl-store-service";
import { passkeyToSave } from "./passkey-storage";

export { createUser, removeCreatedUsers } from "./passkey-storage";

const LIST_PATH = "/api/account/passkeys";
const EXISTING_SIGNED_IN_READ_PATH = "/api/account/mfa";
const EXISTING_SIGNED_IN_CHANGE_PATH = "/api/account/mfa/enroll";
const SESSION_COOKIE_NAME = "__Secure-better-auth.session_token";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };

const sessionDigests = new Set<string>();

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
};

export type Session = { readonly app: Hono; readonly cookie: string };

export const openSession = async (
  userId: string,
  { ttlStoreUncountable = false } = {},
): Promise<Session> => {
  const token = crypto.randomUUID();
  sessionDigests.add(await sha256Hex(token));
  const layers = ttlStoreUncountable
    ? Layer.merge(
        signedIn(userId, `${userId}@example.com`),
        ttlStoreLayer({
          ...testTtlStore,
          incrementRateWindow: () => Promise.reject(new Error("ttl store down")),
        }),
      )
    : signedIn(userId, `${userId}@example.com`);
  return { app: buildAppWith(layers), cookie: `${SESSION_COOKIE_NAME}=${token}` };
};

export const forgetSessionCounts = (): void => {
  for (const key of testKvStore.keys("")) {
    if ([...sessionDigests].some((digest) => key.endsWith(digest))) testKvStore.delete(key);
  }
  sessionDigests.clear();
};

export type ListedPasskey = {
  readonly id: string;
  readonly registeredAt: Date;
  readonly lastUsedAt: Date | null;
};

export type ListOutcome = {
  readonly status: number;
  readonly bodyText: string;
  readonly passkeys: ListedPasskey[] | null;
};

type WireItem = { id: string; created_at: string; last_used_at: string | null };

const outcomeOf = async (response: Response): Promise<ListOutcome> => {
  const bodyText = await response.text();
  if (response.status !== 200) return { status: response.status, bodyText, passkeys: null };
  const body = JSON.parse(bodyText) as { passkeys: WireItem[] };
  return {
    status: response.status,
    bodyText,
    passkeys: body.passkeys.map((item) => ({
      id: item.id,
      registeredAt: new Date(item.created_at),
      lastUsedAt: item.last_used_at === null ? null : new Date(item.last_used_at),
    })),
  };
};

export const readPasskeys = async (session: Session): Promise<ListOutcome> =>
  outcomeOf(await session.app.request(LIST_PATH, { headers: { ...JSON_HEADERS, cookie: session.cookie } }));

export type Failure = { readonly status: number; readonly body: unknown };

const failureOf = async (response: Response): Promise<Failure> => ({
  status: response.status,
  body: await response.json().catch(() => null),
});

const anonymousApp = async (): Promise<Hono> => buildAppWith(signedOut());

export const readPasskeysWithoutSession = async (): Promise<Failure> =>
  failureOf(await (await anonymousApp()).request(LIST_PATH, { headers: JSON_HEADERS }));

export const readExistingSignedInApiWithoutSession = async (): Promise<Failure> =>
  failureOf(
    await (await anonymousApp()).request(EXISTING_SIGNED_IN_READ_PATH, { headers: JSON_HEADERS }),
  );

const crossSiteHeaders = (session: Session) => ({
  cookie: session.cookie,
  "sec-fetch-site": "cross-site",
  "content-type": "application/x-www-form-urlencoded",
});

export const readPasskeysCrossSite = async (session: Session): Promise<number> =>
  (await session.app.request(LIST_PATH, { headers: crossSiteHeaders(session) })).status;

export const readExistingSignedInApiCrossSite = async (session: Session): Promise<number> =>
  (await session.app.request(EXISTING_SIGNED_IN_READ_PATH, { headers: crossSiteHeaders(session) }))
    .status;

export const startMfaEnrollment = async (session: Session): Promise<Failure> =>
  failureOf(
    await session.app.request(EXISTING_SIGNED_IN_CHANGE_PATH, {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: session.cookie, "sec-fetch-site": "same-origin" },
      body: "{}",
    }),
  );

export type StoredPasskey = {
  readonly id: string;
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly registeredAt: Date;
};

export const storePasskey = async (userId: string): Promise<StoredPasskey> => {
  const material = passkeyToSave();
  const row = await insertPasskey({ id: generatePasskeyId(), userId, ...material });
  if (row === undefined) throw new Error("パスキーを保存できなかった");
  return {
    id: row.id,
    credentialId: row.credentialId,
    publicKey: material.publicKey,
    registeredAt: row.createdAt,
  };
};
