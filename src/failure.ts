import { Predicate, Schema } from "effect";

export const WIRE_STATUSES = [400, 401, 403, 404, 409, 410, 429, 503] as const;

export type WireStatus = (typeof WIRE_STATUSES)[number];

export type WireFailure = { readonly "~wireStatus": WireStatus };

export const isWireStatus = (status: unknown): status is WireStatus =>
  Predicate.isNumber(status) && (WIRE_STATUSES as readonly number[]).includes(status);

export const failure =
  <Self = never>() =>
  <Tag extends string, const Fields extends Schema.Struct.Fields>(
    tag: Tag,
    fields: Fields,
    status: WireStatus,
  ) =>
    Schema.TaggedError<Self, WireFailure>()(tag, fields, { httpApiStatus: status });
