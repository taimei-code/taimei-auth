import { useState, type FormEvent } from "react";

import { TAIMEI_SERVICES } from "@core/services";
import type { SignInParams } from "@core/sign-in-params";
import { authClient } from "./auth-client";
import { invitationAcceptCallbackUrl } from "./sign-params";

type SignSubmitting = "magic-link" | "github" | null;

export function useSignPage(
  params: SignInParams,
  options: { preferSignUpUrl?: boolean; githubErrorFallback: string },
) {
  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [submitting, setSubmitting] = useState<SignSubmitting>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const invitationToken = params.invitation_token;
  const isInvitation = invitationToken !== undefined;
  const callbackUrl =
    invitationToken !== undefined
      ? invitationAcceptCallbackUrl(invitationToken)
      : options.preferSignUpUrl
        ? (params.sign_up_url ?? params.redirect_url)
        : params.redirect_url;

  const handleMagicLink = async (e: FormEvent, extra: { name?: string } = {}) => {
    e.preventDefault();
    setSubmitting("magic-link");
    setErrorMessage(null);
    const { error } = await authClient.signIn.magicLink({
      email,
      ...extra,
      callbackURL: callbackUrl,
    });
    setSubmitting(null);
    if (error) {
      setErrorMessage(error.message ?? "Magic Link の送信に失敗しました");
      return;
    }
    setMagicLinkSent(true);
  };

  const handleGitHub = async () => {
    setSubmitting("github");
    setErrorMessage(null);
    const { error } = await authClient.signIn.social({
      provider: "github",
      callbackURL: callbackUrl,
    });
    if (error) {
      setSubmitting(null);
      setErrorMessage(error.message ?? options.githubErrorFallback);
    }
  };

  return {
    serviceDisplayName: TAIMEI_SERVICES[params.service_name].name,
    isInvitation,
    email,
    setEmail,
    magicLinkSent,
    submitting,
    errorMessage,
    handleMagicLink,
    handleGitHub,
  };
}
