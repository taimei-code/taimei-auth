import { Effect } from "effect";
import { Hono } from "hono";
import { z } from "zod";

import { deleteAccountUnlessLastOwner } from "../account/delete-account";
import { switchCompany } from "../account/switch-company";
import { requireActor } from "../membership/guard";
import { parseZodBody, roleBodySchema } from "./parse-body";
import { runRoute } from "./run-route";

export const accountMembership = new Hono();

const setCurrentCompanyBody = z
  .object({ company_id: z.string().min(1).max(64) })
  .transform((d) => ({ targetCompanyId: d.company_id }));
const _updateRoleBody = z.object({ role: roleBodySchema }).transform((d) => ({ nextRole: d.role }));
const _transferOwnershipBody = z
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
