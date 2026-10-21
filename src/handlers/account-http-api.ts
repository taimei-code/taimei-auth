import { handleUpload } from "@vercel/blob/client";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { CurrentActor } from "../account/actor-contract";
import { deleteAccountUnlessLastOwner } from "../account/delete-account";
import { activeMembershipsOf, switchCurrentCompany } from "../membership/current-company";
import { SpaApi } from "../spa-contract";
import { dieOnBoundary } from "./request-http-api";

const ALLOWED_CONTENT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export const AccountHandlers = HttpApiBuilder.group(SpaApi, "account", (handlers) =>
  handlers.handleAll({
    memberships: Effect.fnUntraced(function* () {
      const actor = yield* CurrentActor;
      const rows = yield* activeMembershipsOf(actor.id);
      return {
        current_company_id: actor.lastUsedCompanyId,
        memberships: rows.map((row) => ({
          id: row.id,
          company_id: row.companyId,
          company_name: row.companyName,
          company_org_code: row.companyOrgCode,
          role: row.role,
          joined_at: row.joinedAt.toISOString(),
        })),
      };
    }, dieOnBoundary),
    switchCompany: Effect.fnUntraced(function* ({ payload }) {
      const actor = yield* CurrentActor;
      const result = yield* switchCurrentCompany({
        userId: actor.id,
        companyId: payload.company_id,
      });
      return { ok: true as const, company_id: result.companyId };
    }, dieOnBoundary),
    deleteAccount: Effect.fnUntraced(function* () {
      const actor = yield* CurrentActor;
      yield* deleteAccountUnlessLastOwner(actor.id);
      return { ok: true as const };
    }, dieOnBoundary),
    avatarUploadToken: Effect.fnUntraced(function* ({ payload, request }) {
      const actor = yield* CurrentActor;
      const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);
      const result = yield* Effect.promise(() =>
        handleUpload({
          body: {
            type: payload.type,
            payload: {
              pathname: payload.payload.pathname,
              clientPayload: payload.payload.clientPayload ?? null,
              multipart: payload.payload.multipart ?? false,
            },
          },
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
      if (result.type !== "blob.generate-client-token") return yield* Effect.die(result);
      return { type: result.type, clientToken: result.clientToken };
    }),
  }),
);
