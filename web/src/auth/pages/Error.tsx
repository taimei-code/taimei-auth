import { Option } from "effect";
import { AlertCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "../../shared/ui/alert";
import { errorPageMessage } from "../auth-error-reason";

const message = errorPageMessage(Option.none());

export const ErrorPage = () => {
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
