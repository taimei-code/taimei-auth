import { Schema } from "effect";

export const PageRequestFields = { visit: Schema.Int, requestNumber: Schema.Int };

const PageRequest = Schema.Struct(PageRequestFields);
export type PageRequest = typeof PageRequest.Type;

export const pageRequestOf = ({ visit, requestNumber }: PageRequest): PageRequest => ({
  visit,
  requestNumber,
});

export const firstPageRequest = (visit: number): PageRequest => ({ visit, requestNumber: 0 });

export const withNextPageRequest = <M extends PageRequest>(model: M): M => ({
  ...model,
  requestNumber: model.requestNumber + 1,
});

export const isCurrentPageRequest = (current: PageRequest, response: PageRequest): boolean =>
  response.visit === current.visit && response.requestNumber === current.requestNumber;
