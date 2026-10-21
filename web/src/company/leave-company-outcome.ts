import type { Cause } from "effect";

import type { Forbidden, NotFound, Unauthorized } from "@core/failures";
import type { LastOwner } from "@core/membership/errors";

import { failureOutcome } from "../shared/failure-message";

type LeaveCompanyOutcome = { kind: "soleOwner" } | { kind: "failed"; message: string };

const FAILED: LeaveCompanyOutcome = { kind: "failed", message: "事業所から抜けられませんでした。" };

export const leaveCompanyOutcome = (
  cause: Cause.Cause<LastOwner | Forbidden | NotFound | Unauthorized>,
): LeaveCompanyOutcome =>
  failureOutcome(
    cause,
    { LastOwner: { kind: "soleOwner" }, Forbidden: FAILED, NotFound: FAILED },
    FAILED,
  );
