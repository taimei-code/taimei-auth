import { notifyInBackground } from "../email/notify-in-background";
import type { PasskeyChange } from "../email/passkey-changed";
import { passkeyProviderNameOf } from "./passkey-providers";

export const notifyPasskeyChanged = (params: {
  readonly change: PasskeyChange;
  readonly email: string;
  readonly aaguid: string;
}) =>
  notifyInBackground("passkey-notification", (sender) =>
    sender.sendPasskeyChanged({
      change: params.change,
      email: params.email,
      providerName: passkeyProviderNameOf(params.aaguid),
    }),
  );
