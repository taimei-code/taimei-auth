import type { Effect } from "effect";
import { Context } from "effect";
import type { EmailError } from "../errors";
import type { InvitationEmailParams } from "./send-invitation";

// email provider (Resend) の境界 (ADR-0017 Stage 4)。失敗は EmailError (cause: unknown)。retry はしない (二重送信)。
export class EmailSender extends Context.Service<
  EmailSender,
  {
    sendWelcome(email: string, userName?: string | null): Effect.Effect<void, EmailError>;
    sendMagicLink(email: string, url: string): Effect.Effect<void, EmailError>;
    sendInvitation(params: InvitationEmailParams): Effect.Effect<void, EmailError>;
    sendMfaEnabled(email: string): Effect.Effect<void, EmailError>;
    sendMfaDisabled(email: string): Effect.Effect<void, EmailError>;
  }
>()("taimei/EmailSender") {}
