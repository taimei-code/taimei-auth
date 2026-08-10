import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";

import { TAIMEI_SERVICES, type ServiceName } from "@core/services";
import { signInParamsSchema } from "@core/sign-in-params";
import { authClient } from "@/lib/auth-client";
import { invitationAcceptCallbackUrl } from "@/lib/sign-params";

type SignSubmitting = "magic-link" | "github" | null;

// SignIn / SignUp が共有する画面状態機械。ADR-0007 の「画面のみ分離」を保ったまま、
// params 解析 → 招待分岐 → magic link / GitHub 送信の実装を 1 箇所にする (片画面だけ直して
// 招待経路が壊れる退行 — PR #116 で修正した同型 — の再発防止)。文言・入力欄・リンク先の
// 差分は各ページの JSX が持つ。
export function useSignPage(options: {
  // SignUp のみ true: 遷移元 service が signup 完了後の着地先を sign_up_url で
  // 別指定できる (未指定なら redirect_url に揃う)
  preferSignUpUrl?: boolean;
  githubErrorFallback: string;
}) {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [submitting, setSubmitting] = useState<SignSubmitting>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parseResult = useMemo(
    () => signInParamsSchema.safeParse(Object.fromEntries(searchParams)),
    [searchParams],
  );

  // 招待経由 (相互リンクで SignIn/SignUp 間を移った場合を含む) は着地先を accept-invitation に
  // 揃える。redirect_url へ直行すると membership が作られないまま流れ、受諾フローから脱落する。
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
    // false のときページは /auth/error へ replace して null を返す (handler 群は呼ばれない前提)
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
