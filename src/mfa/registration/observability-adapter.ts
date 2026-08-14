import { Sentry } from "../../sentry";
import type { ReportUnknownTransition } from "./transition";

export const reportUnknownMfaRegistrationTransition: ReportUnknownTransition = ({
  operation,
  phase,
  error,
}) => {
  Sentry.captureException(error, {
    tags: { component: "mfa-registration-transition", operation, phase },
  });
};
