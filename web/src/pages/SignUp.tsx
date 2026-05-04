import { useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { Mail, Github, Loader2 } from "lucide-react";

import { TAIMEI_SERVICES, type ServiceName } from "@core/services";
import { signInParamsSchema } from "@core/sign-in-params";
import { authClient } from "@/lib/auth-client";
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

// Layer B のサインアップ画面。SignIn と同じ Better Auth Magic Link / GitHub OAuth を使うが、
// 違いは 2 点: (1) name 入力欄を追加して新規ユーザー名を取得、(2) callbackURL は sign_up_url
// 優先 (welcome screen 等の onboarding 入口に着地させるため)、無ければ redirect_url にフォールバック。
//
// signin/signup 統合方針 (auth-design.md / Better Auth disableImplicitSignUp: false): 新規/既存
// ユーザーの API レベル分岐は不要。画面は分けるが、内部的には同じ signIn.magicLink を呼ぶ。
export const SignUp = () => {
  const [searchParams] = useSearchParams();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [submitting, setSubmitting] = useState<"magic-link" | "github" | null>(
    null,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parseResult = useMemo(
    () => signInParamsSchema.safeParse(Object.fromEntries(searchParams)),
    [searchParams],
  );

  if (!parseResult.success) {
    window.location.replace("/auth/error?reason=invalid_redirect_url");
    return null;
  }

  const { service_name, redirect_url, sign_up_url } = parseResult.data;
  const service = TAIMEI_SERVICES[service_name as ServiceName];
  const callbackUrl = sign_up_url ?? redirect_url;

  const handleMagicLink = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting("magic-link");
    setErrorMessage(null);
    const { error } = await authClient.signIn.magicLink({
      email,
      name,
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
      setErrorMessage(error.message ?? "GitHub サインアップに失敗しました");
    }
  };

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{service.name} に登録</CardTitle>
          <CardDescription>
            Magic Link または GitHub で新規登録
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {magicLinkSent ? (
            <p className="text-sm text-muted-foreground">
              <strong className="font-medium text-foreground">{email}</strong>{" "}
              に Magic Link を送信しました。メール内のリンクをクリックして登録を完了してください。
            </p>
          ) : (
            <>
              <form onSubmit={handleMagicLink} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="name">お名前</Label>
                  <Input
                    id="name"
                    type="text"
                    required
                    placeholder="山田 太郎"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting !== null}
                  />
                </div>
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
                  disabled={
                    submitting !== null || email === "" || name === ""
                  }
                >
                  {submitting === "magic-link" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <Mail />
                  )}
                  Magic Link で登録
                </Button>
              </form>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    または
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={handleGitHub}
                disabled={submitting !== null}
              >
                {submitting === "github" ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Github />
                )}
                GitHub で登録
              </Button>
            </>
          )}

          {errorMessage && (
            <p className="text-sm text-destructive">{errorMessage}</p>
          )}
        </CardContent>
        <CardFooter className="text-xs text-muted-foreground">
          URL が auth.taimei-code.com であることを確認してください
        </CardFooter>
      </Card>
    </div>
  );
};
