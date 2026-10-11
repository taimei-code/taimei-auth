import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { deleteAccountUnlessLastOwner } from "../account/delete-account";
import { switchCompany } from "../account/switch-company";
import { MembershipRepo } from "../membership/ports";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const AccountHandlers = HttpApiBuilder.group(SpaApi, "account", (handlers) =>
  handlers
    .handle("memberships", () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        const rows = yield* MembershipRepo.use((repo) => repo.findMembershipsByUserId(actor.id));
        return {
          current_company_id: actor.lastUsedCompanyId,
          memberships: rows
            .filter((m) => m.companyActivationStatus === "ACTIVE")
            .map((row) => ({
              id: row.id,
              company_id: row.companyId,
              company_name: row.companyName,
              company_org_code: row.companyOrgCode,
              role: row.role,
              joined_at: row.joinedAt.toISOString(),
            })),
        };
      }).pipe(dieOnBoundary),
    )
    .handle("switchCompany", ({ payload }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        const result = yield* switchCompany({
          actorUserId: actor.id,
          fromCompanyId: actor.lastUsedCompanyId,
          targetCompanyId: payload.company_id,
        });
        return { ok: true as const, company_id: result.companyId };
      }).pipe(dieOnBoundary),
    )
    .handle("deleteAccount", () =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        yield* deleteAccountUnlessLastOwner(actor.id);
        return { ok: true as const };
      }).pipe(dieOnBoundary),
    )
    .handle("avatarUploadToken", ({ payload, request }) =>
      Effect.gen(function* () {
        const actor = yield* CurrentActor;
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
        return yield* Effect.promise(() =>
          handleUpload({
            body: payload as HandleUploadBody,
            request: webRequest,
            onBeforeGenerateToken: async () => ({
              allowedContentTypes: [...ALLOWED_CONTENT_TYPES],
              addRandomSuffix: true,
              maximumSizeInBytes: MAX_SIZE_BYTES,
              tokenPayload: JSON.stringify({ userId: actor.id }),
            }),
            onUploadCompleted: async () => {},
          }),
        );
      }),
    ),
);
