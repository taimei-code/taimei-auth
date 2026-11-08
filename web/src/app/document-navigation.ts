import { Effect, Option, Schema } from "effect";
import { Command } from "foldkit";
import { defineMessageUnion } from "foldkit/message";
import { pushUrl } from "foldkit/navigation";
import { toString as urlToString, type Url } from "foldkit/url";

import { leaveSpaTo, leaveSpaToSignIn, loadDocument } from "../shared/leave-spa";

export const Message = defineMessageUnion({
  CompletedLoadDocument: {},
  CompletedPushUrl: {},
  CompletedReplaceDocument: {},
  CompletedLeaveToSignIn: {},
});
export type Message = typeof Message.Type;

export const LoadDocument = Command.define("LoadDocument", {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadDocument],
  execute: ({ href }) =>
    Effect.sync(() => loadDocument(href)).pipe(Effect.as(Message.CompletedLoadDocument())),
});

export const PushUrl = Command.define("PushUrl", {
  args: { href: Schema.String },
  messages: [Message.CompletedPushUrl],
  execute: ({ href }) => pushUrl(href).pipe(Effect.as(Message.CompletedPushUrl())),
});

export const ReplaceDocument = Command.define("ReplaceDocument", {
  args: { href: Schema.String },
  messages: [Message.CompletedReplaceDocument],
  execute: ({ href }) =>
    Effect.sync(() => leaveSpaTo(href)).pipe(Effect.as(Message.CompletedReplaceDocument())),
});

export const LeaveToSignIn = Command.define("LeaveToSignIn", {
  messages: [Message.CompletedLeaveToSignIn],
  execute: Effect.sync(leaveSpaToSignIn).pipe(Effect.as(Message.CompletedLeaveToSignIn())),
});

export const originOf = (url: Url): string =>
  `${url.protocol}//${url.host}${Option.match(url.port, { onNone: () => "", onSome: (port) => `:${port}` })}`;

export const commandForInternalUrl = (url: Url, isOwnRoute: boolean) =>
  isOwnRoute ? PushUrl({ href: urlToString(url) }) : LoadDocument({ href: urlToString(url) });
