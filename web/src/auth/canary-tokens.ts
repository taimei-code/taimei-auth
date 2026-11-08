import { Option } from "effect";
import type { Html, HtmlBuilder } from "foldkit/html";

import { hiddenInputView } from "../shared/ui/input-view";

const configuredTokenId: string | undefined = import.meta.env.VITE_CANARY_TOKEN_ID;

export const maybeCanaryTokenId: Option.Option<string> = Option.fromNullishOr(
  configuredTokenId,
).pipe(Option.filter((tokenId) => tokenId !== ""));

export const canaryIconId = "canary-token-icon";

const canaryLinkHref = (tokenId: string): string => `/auth/canary-token/${tokenId}`;

export const canaryIconHref = (tokenId: string): string => `${canaryLinkHref(tokenId)}.ico`;

export const canaryTokensView = <Message>(h: HtmlBuilder<Message>): ReadonlyArray<Html> =>
  Option.match(maybeCanaryTokenId, {
    onNone: () => [],
    onSome: (tokenId) => [
      h.a(
        [
          h.Href(canaryLinkHref(tokenId)),
          h.AriaHidden(true),
          h.Tabindex(-1),
          h.Class("pointer-events-none absolute -left-[9999px] -top-[9999px]"),
        ],
        ["canary"],
      ),
      hiddenInputView({ name: "canary_token", value: tokenId }, h),
    ],
  });
