import { Github, Loader2 } from "lucide-react";

import { Button } from "../shared/ui/button";

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
