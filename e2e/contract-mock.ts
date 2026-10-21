import type { Page, Route } from "@playwright/test";
import { spaEndpointTable } from "../src/spa-contract-table";

const endpoints = spaEndpointTable();

const endpointNamed = (name: string) => {
  const endpoint = endpoints.find((candidate) => candidate.name === name);
  if (!endpoint) throw new Error(`the SPA contract has no endpoint named ${name}`);
  return endpoint;
};

const escaped = (segment: string) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const literalSiblingsAt = (segments: ReadonlyArray<string>, index: number) =>
  endpoints
    .map((endpoint) => endpoint.path.split("/"))
    .filter(
      (other) =>
        other.length === segments.length &&
        other.slice(0, index).join("/") === segments.slice(0, index).join("/"),
    )
    .flatMap((other) => other.slice(index, index + 1))
    .filter((segment) => !segment.startsWith(":"));

export const endpointPattern = (name: string): RegExp => {
  const segments = endpointNamed(name).path.split("/");
  const path = segments
    .map((segment, index) => {
      if (!segment.startsWith(":")) return escaped(segment);
      const literals = literalSiblingsAt(segments, index).map(escaped);
      return literals.length === 0 ? "[^/?]+" : `(?!(?:${literals.join("|")})(?:[/?]|$))[^/?]+`;
    })
    .join("/");
  return new RegExp(`^[a-z]+://[^/]+${path}(\\?.*)?$`);
};

export const declaredFailure = (name: string, tag: string) => {
  const status = endpointNamed(name).failures.get(tag);
  if (status === undefined) {
    throw new Error(`the SPA contract does not declare ${tag} for ${name}`);
  }
  return { status, json: { _tag: tag } };
};

export const routeEndpoint = (
  page: Page,
  name: string,
  handler: (route: Route) => Promise<unknown> | unknown,
  options?: { times?: number },
) => {
  const { method } = endpointNamed(name);
  return page.route(
    endpointPattern(name),
    (route) => (route.request().method() === method ? handler(route) : route.fallback()),
    options,
  );
};
