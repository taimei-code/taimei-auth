import { runBackground } from "../background";
import { sendMfaDisabledEmail, sendMfaEnabledEmail } from "../email/send-mfa-notification";

export function notifyMfaEnabled(email: string): void {
  schedule(sendMfaEnabledEmail(email));
}

export function notifyMfaDisabled(email: string): void {
  schedule(sendMfaDisabledEmail(email));
}

export async function notifyMfaDisabledForManagement(email: string): Promise<boolean> {
  return sendMfaDisabledEmail(email)
    .then(() => true)
    .catch((error: unknown) => {
      console.error("failed to send MFA disabled notification email", error);
      return false;
    });
}

function schedule(sending: Promise<void>): void {
  runBackground(
    sending.catch((error: unknown) => {
      console.error("failed to send MFA notification email", error);
    }),
  );
}
