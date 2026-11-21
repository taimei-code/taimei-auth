import { Option, Schema } from "effect";
import { defineTaggedUnion } from "foldkit/schema";

export const Submission = defineTaggedUnion({
  Idle: {},
  Submitting: {},
  Rejected: { message: Schema.String },
});
export type Submission = typeof Submission.Type;

export const submissionWhile = (isSubmitting: boolean): Submission =>
  isSubmitting ? Submission.Submitting() : Submission.Idle();

export const withoutRejection = (submission: Submission): Submission =>
  Submission.guards.Rejected(submission) ? Submission.Idle() : submission;

export const maybeRejectedMessage = (submission: Submission): Option.Option<string> =>
  Submission.matchOrElse(submission, { Rejected: ({ message }) => Option.some(message) }, () =>
    Option.none(),
  );
