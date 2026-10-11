import { getRouteApi } from "@tanstack/react-router";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../shared/ui/card";

const route = getRouteApi("/auth/signup/accept-invitation");

export const SignUpAcceptInvitation = () => {
  const { message } = route.useLoaderData();

  return (
    <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>招待を受諾できませんでした</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <a
            href="/account"
            className="text-sm font-medium text-foreground underline underline-offset-4"
          >
            アカウントに戻る
          </a>
        </CardContent>
      </Card>
    </div>
  );
};
