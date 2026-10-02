import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { deleteAccountUnlessLastOwner } from "../account/delete-account";
import { switchCompany } from "../account/switch-company";
import { changeRole } from "../membership/change-role";
import {
  requireActor,
  requireRemoval,
  requireRoleChange,
  requireTransferOwnership,
} from "../membership/guard";
import { removeMember } from "../membership/remove";
import { transferOwnership } from "../membership/transfer-ownership";
import { parseZodBody, roleBodySchema } from "./parse-body";
import { runRoute } from "./run-route";

export const accountMembership = new Hono();

const setCurrentCompanyBody = z
  .object({ company_id: z.string().min(1).max(64) })
  .transform((d) => ({ targetCompanyId: d.company_id }));
const updateRoleBody = z.object({ role: roleBodySchema }).transform((d) => ({ nextRole: d.role }));
const transferOwnershipBody = z
  .object({ to_user_id: z.string().min(1).max(64) })
  .transform((d) => ({ toUserId: d.to_user_id }));

accountMembership.post("/api/account/current-company", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      const parsed = yield* parseZodBody(c, setCurrentCompanyBody);
      const result = yield* switchCompany({
        actorUserId: actor.id,
        fromCompanyId: actor.lastUsedCompanyId,
        targetCompanyId: parsed.targetCompanyId,
      });
      return c.json({ ok: true, company_id: result.companyId });
    }),
  ),
);

accountMembership.post("/api/account/companies/:companyId/members/:targetUserId/role", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const targetUserId = c.req.param("targetUserId");
      const grant = yield* requireRoleChange({
        headers: c.req.raw.headers,
        companyId,
        targetUserId,
        parseBody: parseZodBody(c, updateRoleBody),
      });
      yield* changeRole({
        actorUserId: grant.actor.id,
        targetUserId,
        companyId,
        beforeRole: grant.targetRole,
        nextRole: grant.nextRole,
      });
      return c.json({ ok: true });
    }),
  ),
);

accountMembership.post("/api/account/companies/:companyId/members/:targetUserId/remove", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const targetUserId = c.req.param("targetUserId");
      const { actor, targetRole } = yield* requireRemoval({
        headers: c.req.raw.headers,
        companyId,
        targetUserId,
      });
      const result = yield* removeMember({
        actorUserId: actor.id,
        targetUserId,
        companyId,
        targetRole,
      });
      return c.json({ ok: true, account_deleted: result.accountDeleted });
    }),
  ),
);

accountMembership.post("/api/account/companies/:companyId/transfer-ownership", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const companyId = c.req.param("companyId");
      const grant = yield* requireTransferOwnership({
        headers: c.req.raw.headers,
        companyId,
        parseBody: parseZodBody(c, transferOwnershipBody),
      });
      yield* transferOwnership({
        actorUserId: grant.actor.id,
        toUserId: grant.toUserId,
        companyId,
      });
      return c.json({ ok: true });
    }),
  ),
);

accountMembership.post("/api/account/delete", (c) =>
  runRoute(
    c,
    Effect.gen(function* () {
      const actor = yield* requireActor(c.req.raw.headers);
      yield* deleteAccountUnlessLastOwner(actor.id);
      return c.json({ ok: true });
    }),
  ),
);
