import { Github, Loader2 } from "lucide-react";

import { Button } from "../shared/ui/button";

// Magic Link フォーム下の SNS ログイン区画。招待経由では GitHub を隠して案内文に差し替える —
// invitation の strict email match は Magic Link 経路を前提とし、GitHub アカウントの email が
// 招待先と一致する保証がないため。SignIn / SignUp 両ページで共有し、招待分岐の
// 変更が片ページだけに入るのを防ぐ。boolean 2 つで受けるのは useSignPage の状態表現に
// 依存させないため (表示部品はどの送信手段が走っているかの内部型を知らなくてよい)。
export const SocialSignInSection = ({
  isInvitation,
  disabled,
  submittingGitHub,
  label,
  onGitHub,
}: {
  isInvitation: boolean;
  disabled: boolean;
  submittingGitHub: boolean;
  label: string;
  onGitHub: () => void;
}) => {
  if (isInvitation) {
    return (
      <p className="text-center text-xs text-muted-foreground">
        招待を受諾するには、招待されたメールアドレスで Magic Link をご利用ください。
      </p>
    );
  }

  return (
    <>
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
        onClick={onGitHub}
        disabled={disabled}
      >
        {submittingGitHub ? <Loader2 className="animate-spin" /> : <Github />}
        {label}
      </Button>
    </>
  );
};
