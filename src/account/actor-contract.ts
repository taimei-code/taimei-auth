import { Context } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import { Unauthorized } from "../failures";

export type Actor = {
  readonly id: string;
  readonly email: string;
  readonly lastUsedCompanyId: string | null;
};

export class CurrentActor extends Context.Service<CurrentActor, Actor>()("taimei/CurrentActor") {}

export class Authenticated extends HttpApiMiddleware.Service<
  Authenticated,
  { provides: CurrentActor }
>()("taimei/Authenticated", { error: Unauthorized }) {}
