import { spyOn } from "bun:test";
import { Effect } from "effect";
import { withSpy } from "../../src/__tests__/live-runner";
import { emailSenderLive } from "../../src/email/wiring";

export const magicLinksSentWhile = (send: () => Promise<Response>) =>
  withSpy(
    () => spyOn(emailSenderLive, "sendMagicLink"),
    (spy) =>
      Effect.promise(send).pipe(
        Effect.map((response) => ({ response, magicLinksSent: spy.mock.calls.length })),
      ),
  );
