import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Mail, Github, Loader2 } from "lucide-react";

import { TAIMEI_SERVICES, type ServiceName } from "@core/services";
import { signInParamsSchema } from "@core/sign-in-params";
import { authClient } from "@/lib/auth-client";
import { buildSignParams } from "@/lib/sign-params";
import { CanaryTokens } from "@/components/CanaryTokens";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Layer B のログイン画面。signInParamsSchema (PR1) でクエリ検証 → 不正なら /auth/error に誘導。
// Magic Link (Better Auth magicLinkClient) と GitHub OAuth (signIn.social) の 2 経路を提供。
export const SignIn = () => {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [submitting, setSubmitting] = useState<"magic-link" | "github" | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parseResult = useMemo(
    () => signInParamsSchema.safeParse(Object.fromEntries(searchParams)),
    [searchParams],
  );

  if (!parseResult.success) {
    window.location.replace("/auth/error?reason=invalid_redirect_url");
    return null;
  }

  const { service_name, redirect_url } = parseResult.data;
  const service = TAIMEI_SERVICES[service_name as ServiceName];

  const handleMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting("magic-link");
    setErrorMessage(null);
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: redirect_url,
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
      callbackURL: redirect_url,
    });
    if (error) {
      setSubmitting(null);
      setErrorMessage(error.message ?? "GitHub ログインに失敗しました");
    }
  };

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <CanaryTokens />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{service.name} にログイン</CardTitle>
          <CardDescription>Magic Link または GitHub アカウントでログイン</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {magicLinkSent ? (
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">{email}</strong> に Magic Link
              を送信しました。メール内のリンクをクリックしてログインを完了してください。
            </p>
          ) : (
            <>
              <form onSubmit={handleMagicLink} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="email">メールアドレス</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting !== null}
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting !== null || email === ""}
                >
                  {submitting === "magic-link" ? <Loader2 className="animate-spin" /> : <Mail />}
                  Magic Link を送信
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">または</span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGitHub}
                disabled={submitting !== null}
              >
                {submitting === "github" ? <Loader2 className="animate-spin" /> : <Github />}
                GitHub でログイン
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                アカウントをお持ちでない方は{" "}
                <Link
                  to={`/auth/signup?${buildSignParams(searchParams)}`}
                  className="font-medium text-foreground underline"
                >
                  新規登録
                </Link>
              </p>
            </>
          )}

          {errorMessage && <p className="text-sm text-destructive">{errorMessage}</p>}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          URL が auth.taimei-code.com であることを確認してください
        </CardFooter>
      </Card>
    </div>
  );
};
