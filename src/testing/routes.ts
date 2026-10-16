import {
  TESTING_PATH,
  type SignedInUser,
  type SignedInUserRequest,
  type SetCurrentCompanyRequest,
} from "@taimei-code/auth-client/testing";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "@/db/client";
import { generateCompanyId } from "@/db/repositories/company";
import { generateMembershipId } from "@/db/repositories/membership";
import { company, membership, user } from "@/db/schema";
import { MAGIC_LINK_EXPIRES_IN_SECONDS } from "@taimei-code/auth-client";
import { auth } from "../auth";

const issueLoginUrl = async (email: string, returnTo: string): Promise<string> => {
  const context = await auth.$context;
  const token = crypto.randomUUID().replaceAll("-", "");
  await context.internalAdapter.createVerificationValue({
    identifier: token,
    value: JSON.stringify({ email }),
    expiresAt: new Date(Date.now() + MAGIC_LINK_EXPIRES_IN_SECONDS * 1000),
  });
  const url = new URL("/api/auth/magic-link/verify", context.baseURL);
  url.searchParams.set("token", token);
  url.searchParams.set("callbackURL", returnTo);
  return url.toString();
};

export const createSignedInUser = async (body: SignedInUserRequest): Promise<SignedInUser> => {
  const userId = crypto.randomUUID();
  const email = `test-${userId}@example.com`;
  const companyIds = body.companies.map((entry) => entry.id ?? generateCompanyId());
  await db.insert(user).values({ id: userId, name: body.name ?? "Test User", email });
  for (const [index, entry] of body.companies.entries()) {
    const companyId = companyIds[index] as string;
    await db
      .insert(company)
      .values({ id: companyId, name: entry.name ?? "Test Company", orgCode: "CORPORATE" })
      .onConflictDoNothing();
    await db.insert(membership).values({ id: generateMembershipId(), userId, companyId, role: entry.role });
  }
  await db
    .update(user)
    .set({ lastUsedCompanyId: body.currentCompanyId ?? companyIds[0] ?? null })
    .where(eq(user.id, userId));
  return { userId, email, companyIds, loginUrl: await issueLoginUrl(email, body.returnTo) };
};

export const setCurrentCompany = async (body: SetCurrentCompanyRequest): Promise<boolean> => {
  const [row] = await db
    .select({ id: membership.id })
    .from(membership)
    .where(and(eq(membership.userId, body.userId), eq(membership.companyId, body.companyId)));
  if (!row) return false;
  await db.update(user).set({ lastUsedCompanyId: body.companyId }).where(eq(user.id, body.userId));
  return true;
};

export const testingRoutes = new Hono()
  .post(`${TESTING_PATH}/signed-in-users`, async (c) =>
    c.json(await createSignedInUser(await c.req.json<SignedInUserRequest>())),
  )
  .post(`${TESTING_PATH}/current-company`, async (c) =>
    (await setCurrentCompany(await c.req.json<SetCurrentCompanyRequest>()))
      ? c.json({ ok: true })
      : c.json({ ok: false }, 403),
  );
