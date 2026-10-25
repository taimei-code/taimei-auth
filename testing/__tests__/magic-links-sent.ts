import { spyOn } from "bun:test";
import { Effect } from "effect";
import { withSpy } from "../../src/__tests__/live-runner";
import { recordingEmailSenderService } from "../sent-links";

export const magicLinksSentWhile = (send: () => Promise<Response>) =>
  withSpy(
    () => spyOn(recordingEmailSenderService, "sendMagicLink"),
    (spy) =>
      Effect.promise(send).pipe(
        Effect.map((response) => ({ response, magicLinksSent: spy.mock.calls.length })),
      ),
  );
