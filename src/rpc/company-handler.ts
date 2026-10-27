import { create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { Effect } from "effect";
import { z } from "zod";
import { CompanyRepo } from "../company/ports";
import {
  CheckMembershipsResponseSchema,
  CompanyActivationStatus,
  CompanyService,
} from "../gen/auth/v1/auth_pb";
import { InvalidArgument } from "../failures";
import { MembershipRepo } from "../membership/ports";
import { toProtoCompanyActivationStatus } from "./mappers";
import { runRpc } from "./run-rpc";

const boundedId = z.string().min(1).max(64);
const checkMembershipsRequest = z.object({
  companyId: boundedId,
  userIds: z.array(boundedId).max(1000),
});

export const checkMembershipsProgram = Effect.fnUntraced(function* (req: {
  companyId: string;
  userIds: readonly string[];
}) {
  const parsed = checkMembershipsRequest.safeParse(req);
  if (!parsed.success) return yield* new InvalidArgument({});
  const { companyId, userIds } = parsed.data;

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
