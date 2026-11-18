import { Hono } from "hono";
import { generatePasskeyId, insertPasskey } from "../../db/repositories/passkey";
import { dbTest } from "../../src/__tests__/live-runner";
import { browserCookieHeaders, loginWithMagicLink } from "../../src/__tests__/session-helpers";
import { buildAppWith } from "../../src/handlers/__tests__/helpers";
import { mountSpaApi } from "../../src/handlers/spa-http-api";
import { signedOut } from "../../src/membership/__tests__/test-layers";
import { checkSession } from "../../src/session-check";
import { type Session, type User } from "./passkey-registration-api";
import { passkeyToSave } from "./passkey-storage";

export {
  createUser,
  forgetScenario,
  openSession,
  readListedIds,
  type Session,
} from "./passkey-registration-api";

const deletionPath = (passkeyId: string) =>
  `/api/account/passkeys/${encodeURIComponent(passkeyId)}/delete`;
const EXISTING_SIGNED_IN_POST_PATH = "/api/account/mfa/enroll";
const JSON_HEADERS = { accept: "application/json", "content-type": "application/json" };
const CALLBACK = "https://app.example.com/dashboard";

const { run } = dbTest("acc-492-");

export const storePasskey = async (user: User): Promise<string> => {
  const row = await insertPasskey({ id: generatePasskeyId(), userId: user.id, ...passkeyToSave() });
  if (row === undefined) throw new Error("パスキーを保存できなかった");
  return row.id;
};

export const missingPasskeyId = (): string => crypto.randomUUID();

const liveApp = (): Hono => {
  const app = new Hono();
  mountSpaApi(app);
  return app;
};

export const signIn = async (user: User): Promise<Session> => {
  const login = await run(loginWithMagicLink({ email: user.email, callbackURL: CALLBACK }));
  const cookie = browserCookieHeaders(login.response).get("cookie");
  if (cookie === null) throw new Error("ログインの cookie が無い");
  return { user, app: liveApp(), cookie };
};

export const isSessionActive = async (session: Session): Promise<boolean> =>
  (await run(checkSession(new Headers({ cookie: session.cookie }))))._tag === "Active";

export type Outcome = { readonly status: number; readonly body: string };

const outcomeOf = async (response: Response): Promise<Outcome> => ({
  status: response.status,
  body: await response.text(),
});

export const sendDeletion = async (session: Session, passkeyId: string): Promise<Outcome> =>
  outcomeOf(
    await session.app.request(deletionPath(passkeyId), {
      method: "POST",
      headers: { ...JSON_HEADERS, cookie: session.cookie, "sec-fetch-site": "same-origin" },
      body: "{}",
    }),
  );

const postWithoutSession = async (path: string): Promise<Outcome> =>
  outcomeOf(
    await buildAppWith(signedOut()).request(path, {
      method: "POST",
      headers: { ...JSON_HEADERS, "sec-fetch-site": "same-origin" },
      body: "{}",
    }),
  );

export const sendDeletionWithoutSession = (passkeyId: string): Promise<Outcome> =>
  postWithoutSession(deletionPath(passkeyId));

export const existingSignedInPostWithoutSession = (): Promise<Outcome> =>
  postWithoutSession(EXISTING_SIGNED_IN_POST_PATH);

const postCrossSite = async (session: Session, path: string): Promise<number> =>
  (
    await session.app.request(path, {
      method: "POST",
      headers: { cookie: session.cookie, "sec-fetch-site": "cross-site" },
    })
  ).status;

export const sendDeletionCrossSite = (session: Session, passkeyId: string): Promise<number> =>
  postCrossSite(session, deletionPath(passkeyId));

export const existingSignedInPostCrossSite = (session: Session): Promise<number> =>
  postCrossSite(session, EXISTING_SIGNED_IN_POST_PATH);
