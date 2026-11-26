import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { Effect, Schema } from "effect";
import { CompanyRepo } from "../company/ports";
import {
  CheckMembershipsResponseSchema,
  CompanyActivationStatus,
  CompanyService,
} from "../gen/auth/v1/auth_pb";
import { InvalidArgument } from "../failures";
import { Id } from "../spa-contract-schemas";
import { MembershipRepo } from "../membership/ports";
import { toProtoCompanyActivationStatus } from "./mappers";
import { runRpc } from "./run-rpc";

const decodeCheckMembershipsRequest = Schema.decodeUnknownEffect(
  Schema.Struct({
    companyId: Id,
    userIds: Schema.Array(Id).check(Schema.isMaxLength(1000)),
  }),
);

export const checkMembershipsProgram = Effect.fnUntraced(function* (req: {
  companyId: string;
  userIds: readonly string[];
}) {
  const { companyId, userIds } = yield* decodeCheckMembershipsRequest(req).pipe(
    Effect.mapError(() => new InvalidArgument({})),
  );

  const company = yield* CompanyRepo.use((repo) => repo.findCompanyById(companyId));
  const companyActivationStatus =
    company === undefined
      ? CompanyActivationStatus.NOT_FOUND
      : toProtoCompanyActivationStatus(company.activationStatus);
  const companyActive = companyActivationStatus === CompanyActivationStatus.ACTIVE;
  const memberUserIds = companyActive
    ? yield* MembershipRepo.use((repo) => repo.findMemberUserIds(companyId, userIds))
    : [];
  return create(CheckMembershipsResponseSchema, {
    companyActive,
    companyActivationStatus,
    memberUserIds,
  });
});

export function registerCompanyService(router: ConnectRouter) {
  router.service(CompanyService, {
    checkMemberships: (req) => runRpc(checkMembershipsProgram(req)),
  });
}
