import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { TAIMEI_SERVICES, type ServiceName } from "@core/services";
import { signInParamsSchema } from "@core/sign-in-params";
import { authClient } from "./auth-client";
import { invitationAcceptCallbackUrl } from "./sign-params";

type SignSubmitting = "magic-link" | "github" | null;

export function useSignPage(options: { preferSignUpUrl?: boolean; githubErrorFallback: string }) {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [submitting, setSubmitting] = useState<SignSubmitting>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parseResult = useMemo(
    () => signInParamsSchema.safeParse(Object.fromEntries(searchParams)),
    [searchParams],
  );

  const invitationToken = parseResult.success ? parseResult.data.invitation_token : undefined;
  const isInvitation = invitationToken !== undefined;
  const callbackUrl = !parseResult.success
    ? null
    : invitationToken !== undefined
      ? invitationAcceptCallbackUrl(invitationToken)
      : options.preferSignUpUrl
        ? (parseResult.data.sign_up_url ?? parseResult.data.redirect_url)
        : parseResult.data.redirect_url;

  const handleMagicLink = async (e: FormEvent, extra: { name?: string } = {}) => {
    e.preventDefault();
    setSubmitting("magic-link");
    setErrorMessage(null);
    const { error } = await authClient.signIn.magicLink({
      email,
      ...extra,
      callbackURL: callbackUrl ?? "",
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
      callbackURL: callbackUrl ?? "",
    });
    if (error) {
      setSubmitting(null);
      setErrorMessage(error.message ?? options.githubErrorFallback);
    }
  };

  return {
    paramsValid: parseResult.success,
    serviceDisplayName: parseResult.success
      ? TAIMEI_SERVICES[parseResult.data.service_name as ServiceName].name
      : "",
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
