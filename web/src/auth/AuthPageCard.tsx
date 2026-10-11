import type { ReactNode } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../shared/ui/card";

type Props = { title: string; description: string; children: ReactNode };

export const AuthPageCard = ({ title, description, children }: Props) => (
  <div className="relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
      <CardFooter className="text-xs text-muted-foreground">
        URL が auth.taimei-code.com であることを確認してください
      </CardFooter>
    </Card>
  </div>
);
