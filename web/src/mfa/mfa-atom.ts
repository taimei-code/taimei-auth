import { useAtomSet } from "@effect/atom-react";
import type { Cause } from "effect";

import { failureMessage } from "../shared/failure-message";
import { SpaApiClient } from "../shared/spa-api-client";
import {
  MFA_FAILURE_MESSAGES,
  MFA_GENERIC_FAILURE_MESSAGE,
  type MfaFailure,
} from "./mfa-failure-messages";

import type { MfaCodeKind } from "@core/mfa/mfa-contract";

export type { MfaCodeKind, MfaFailure };

const MFA_STATUS_KEY = "mfa-status";

export const mfaStatusAtom = SpaApiClient.query("mfa", "status", {
  reactivityKeys: [MFA_STATUS_KEY],
});
const enrollMfaAtom = SpaApiClient.mutation("mfa", "enroll");
const activateMfaAtom = SpaApiClient.mutation("mfa", "activate");
const disableMfaAtom = SpaApiClient.mutation("mfa", "disable");

export const mfaFailureMessage = (cause: Cause.Cause<MfaFailure>): string =>
  failureMessage(cause, MFA_FAILURE_MESSAGES, MFA_GENERIC_FAILURE_MESSAGE);

export const useEnrollMfa = () => {
  const enroll = useAtomSet(enrollMfaAtom, { mode: "promiseExit" });
  return () => enroll({});
};

export const useActivateMfa = () => {
  const activate = useAtomSet(activateMfaAtom, { mode: "promiseExit" });
  return (payload: { code: string; enrollment_id: string }) => activate({ payload });
};

export const useDisableMfa = () => {
  const disable = useAtomSet(disableMfaAtom, { mode: "promiseExit" });
  return (payload: { code: string; kind: MfaCodeKind }) =>
    disable({ payload, reactivityKeys: [MFA_STATUS_KEY] });
};
