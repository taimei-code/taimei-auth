import type { Effect } from "effect";
import { Context } from "effect";
import type { EmailError } from "../errors";
import type { DisplayText } from "./sanitize";
import type { InvitationEmailParams } from "./send-invitation";

export class EmailSender extends Context.Service<
  EmailSender,
  {
    sendWelcome(email: string, userName: DisplayText): Effect.Effect<void, EmailError>;
    sendMagicLink(email: string, url: string): Effect.Effect<void, EmailError>;
    sendInvitation(params: InvitationEmailParams): Effect.Effect<void, EmailError>;
    sendMfaEnabled(email: string): Effect.Effect<void, EmailError>;
    sendMfaDisabled(email: string): Effect.Effect<void, EmailError>;
  }
>()("taimei/EmailSender") {}
