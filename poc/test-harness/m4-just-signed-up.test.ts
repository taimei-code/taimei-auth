import { expect, test } from "bun:test";
import { isJustSignedUp, type SessionData } from "@taimei-code/auth-client";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { user, verification } from "@/db/schema";
import { buildApp } from "../../src/app";
import { auth } from "../../src/auth";

const sessionDataOf = (createdAt: Date): SessionData => ({
  user: {
    id: "u",
    name: "n",
    email: "e",
    emailVerified: true,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
  },
  session: { id: "s", expiresAt: "", kind: "user" },
});

test("Magic Link で登録した直後の user は登録の直後と判定され、1 日前に作った user は判定されない", async () => {
  const app = buildApp({ mountStatic: () => {} });
  const email = `poc-m4-${crypto.randomUUID()}@example.com`;
  const callbackURL = "http://localhost:3000/after";
  const send = await app.request("/api/auth/sign-in/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://localhost:3199" },
    body: JSON.stringify({ email, callbackURL }),
  });
  expect(send.status).toBe(200);
  const rows = await db.select().from(verification).orderBy(desc(verification.createdAt)).limit(20);
  const row = rows.find((r) => r.value.includes(email));
  if (!row) throw new Error("verification row not found");
  const verify = await app.request(
    `/api/auth/magic-link/verify?token=${row.identifier}&callbackURL=${encodeURIComponent(callbackURL)}`,
  );
  console.log(`OBSERVE magic-link verify status=${verify.status} location=${verify.headers.get("location")}`);
  const [created] = await db.select().from(user).where(eq(user.email, email));
  if (!created) throw new Error("user not created by magic link sign-up");
  console.log(`OBSERVE magic-link createdAt=${created.createdAt.toISOString()} now=${new Date().toISOString()}`);
  expect(isJustSignedUp(sessionDataOf(created.createdAt))).toBe(true);
  expect(isJustSignedUp(sessionDataOf(new Date(Date.now() - 24 * 60 * 60 * 1000)))).toBe(false);
});

test("GitHub の登録が使う createOAuthUser で作った user は登録の直後と判定される (GitHub の実通信の代わり)", async () => {
  const context = await auth.$context;
  const email = `poc-m4-gh-${crypto.randomUUID()}@example.com`;
  const { user: created } = await context.internalAdapter.createOAuthUser(
    { name: "gh", email, emailVerified: true },
    { providerId: "github", accountId: crypto.randomUUID() },
  );
  console.log(`OBSERVE oauth createdAt=${new Date(created.createdAt).toISOString()}`);
  expect(isJustSignedUp(sessionDataOf(new Date(created.createdAt)))).toBe(true);
});
