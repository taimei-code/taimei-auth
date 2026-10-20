import { Exit } from "effect";
import type { AtomRegistry } from "effect/reactivity";

import type { EmailMismatch, ExpiredOrUsed } from "@core/invitation/errors";
import type { NotFound, Unauthorized } from "@core/failures";

import { authClient } from "../auth/auth-client";
import { runMutation } from "../shared/atom-runtime";
import { failureMessage } from "../shared/failure-message";
import type { RouteEntry } from "../shared/route-entry";
import { acceptInvitationAtom } from "./invitation-atom";
import { type AcceptInvitationSearch, redirectUrlAfterAccept } from "./redirect-target";

export type AcceptOutcome = Extract<RouteEntry, { kind: "signIn" | "goToRedirectUrl" | "failed" }>;

type AcceptDeps = {
  hasSession: () => Promise<boolean>;
  accept: (
    invitationToken: string,
  ) => Promise<Exit.Exit<unknown, EmailMismatch | ExpiredOrUsed | NotFound | Unauthorized>>;
};

const ACCEPT_FAILED = "招待の受諾に失敗しました。";

const failed = (message: string): AcceptOutcome => ({ kind: "failed", message });

const outcomeOfAccepted = (
  search: AcceptInvitationSearch,
  exit: Awaited<ReturnType<AcceptDeps["accept"]>>,
): AcceptOutcome => {
  if (Exit.isSuccess(exit))
    return { kind: "goToRedirectUrl", redirectUrl: redirectUrlAfterAccept(search) };
  return failed(
    failureMessage(
      exit.cause,
      {
        EmailMismatch:
          "この招待は別のメールアドレス宛です。招待されたアドレスでログインし直してください。",
        ExpiredOrUsed: "この招待は期限切れか、既に使用されています。",
        NotFound: "招待が見つかりません。",
      },
      ACCEPT_FAILED,
    ),
  );
};

export const acceptInvitationOutcome = async (
  search: AcceptInvitationSearch,
  deps: AcceptDeps,
): Promise<AcceptOutcome> => {
  const invitationToken = search.invitation_token;
  if (!invitationToken) return failed("招待トークンが見つかりません。");
  try {
    if (!(await deps.hasSession())) return { kind: "signIn" };
    return outcomeOfAccepted(search, await deps.accept(invitationToken));
  } catch {
    return failed(ACCEPT_FAILED);
  }
};

export const acceptInvitation = (
  registry: AtomRegistry.AtomRegistry,
  search: AcceptInvitationSearch,
): Promise<AcceptOutcome> =>
  acceptInvitationOutcome(search, {
    hasSession: () => authClient.getSession().then(({ data }) => Boolean(data?.session)),
    accept: (invitationToken) =>
      runMutation(registry, acceptInvitationAtom, {
        payload: { invitation_token: invitationToken },
      }),
  });
