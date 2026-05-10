import { useSearchParams } from "react-router-dom";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

const ERROR_MESSAGES: Record<string, { title: string; description: string }> = {
  invalid_redirect_url: {
    title: "不正なリダイレクト URL",
    description:
      "リダイレクト先が許可されていません。ログインリクエストを発行したサービスから再度ログインしてください。",
  },
  signup_already_completed: {
    title: "サインアップ済みです",
    description: "既に登録済みのアカウントです。ログイン画面からログインしてください。",
  },
  signin_failed: {
    title: "ログインに失敗しました",
    description: "ログイン処理中にエラーが発生しました。再度お試しください。",
  },
  default: {
    title: "エラーが発生しました",
    description: "予期せぬエラーが発生しました。時間を置いて再度お試しください。",
  },
};

export const ErrorPage = () => {
  const [searchParams] = useSearchParams();
  const reason = searchParams.get("reason") ?? "default";
  const message = ERROR_MESSAGES[reason] ?? ERROR_MESSAGES.default;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>{message.title}</AlertTitle>
          <AlertDescription>{message.description}</AlertDescription>
        </Alert>
      </div>
    </div>
  );
};
