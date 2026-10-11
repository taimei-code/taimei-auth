// F oRPC contract-first (zod で宣言、implement で実装)
import { createORPCClient, isDefinedError, safe } from "@orpc/client";
import { type ContractRouterClient, oc } from "@orpc/contract";
import { implement, ORPCError } from "@orpc/server";
import { Effect } from "effect";
import { z } from "zod";

const contract = {
  members: {
    changeRole: oc.route({ method: "POST", path: "/companies/{companyId}/members/{targetUserId}/role" })
      .input(z.object({ companyId: z.string(), targetUserId: z.string(), role: z.enum(["OWNER", "ADMIN", "MEMBER"]) }))
      .output(z.object({ ok: z.literal(true) }))
      .errors({ LAST_OWNER: { status: 409 }, FORBIDDEN: { status: 403 } }),
    list: oc.route({ method: "GET", path: "/companies/{companyId}/members" })
      .input(z.object({ companyId: z.string() }))
      .output(z.object({ members: z.array(z.object({ user_id: z.string() })) })),
  },
};
const os = implement(contract);
const changeRole = os.members.changeRole.handler(async ({ input, errors }) => { if (input.role === "OWNER") throw errors.LAST_OWNER(); return { ok: true as const }; });
const list = os.members.list.handler(async () => ({ members: [] }));
export const router = os.router({ members: { changeRole, list } });

// @ts-expect-error K3 応答の形が宣言と違う
os.members.changeRole.handler(async () => ({ wrong: 1 }));
// @ts-expect-error K4 宣言のない失敗 (errors から作る)
os.members.changeRole.handler(async ({ errors }) => { throw errors.EMAIL_MISMATCH(); });
// @ts-expect-error K4b 宣言のない失敗 (ORPCError を直接 throw)
os.members.changeRole.handler(async () => { throw new ORPCError("EMAIL_MISMATCH", { status: 403 }); });
// @ts-expect-error K6 handler の書き漏れ
os.router({ members: { changeRole } });
// @ts-expect-error E1 handler が Effect をそのまま返す
os.members.list.handler(() => Effect.succeed({ members: [] }));

declare const client: ContractRouterClient<typeof contract>;
export async function probes() {
  // @ts-expect-error K1 procedure 名の打ち間違い
  await client.members.chnageRole({ companyId: "x", targetUserId: "u", role: "ADMIN" });
  // @ts-expect-error K2 入力の型違い
  await client.members.changeRole({ companyId: "x", targetUserId: "u", role: "BOSS" });
  const [error] = await safe(client.members.changeRole({ companyId: "x", targetUserId: "u", role: "ADMIN" }));
  if (isDefinedError(error)) {
    // @ts-expect-error K5 宣言にない失敗の名前を扱う
    if (error.code === "LAST_OWNERR") return;
  }
  // @ts-expect-error E2 client が Effect を返す
  const e: Effect.Effect<unknown, unknown> = client.members.list({ companyId: "x" });
  return [e, createORPCClient];
}
