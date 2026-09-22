import { Data } from "effect";

export class AuthServiceUnavailable extends Data.TaggedError("AuthServiceUnavailable")<{
  message: string;
  cause?: unknown;
}> {}

export class AuthServiceTimeout extends Data.TaggedError("AuthServiceTimeout")<{
  message: string;
  cause?: unknown;
}> {}

export class AuthServiceUnauthorized extends Data.TaggedError("AuthServiceUnauthorized")<{
  message: string;
}> {}
