import { SchemaAST } from "effect";
import { HttpApi } from "effect/http-api";
import { SpaApi } from "./spa-contract";

export type SpaEndpoint = {
  readonly name: string;
  readonly method: string;
  readonly path: string;
  readonly middleware: ReadonlySet<{ key: string }>;
  readonly hasPayload: boolean;
  readonly failures: ReadonlyMap<string, number>;
};

export const spaEndpointTable = (): SpaEndpoint[] => {
  const endpoints: SpaEndpoint[] = [];
  HttpApi.reflect(SpaApi, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, middleware, errors }) => {
      const failures = new Map<string, number>();
      for (const [status, schemas] of errors) {
        for (const schema of schemas) {
          const tag = SchemaAST.resolveIdentifier(schema.ast);
          if (tag !== undefined) failures.set(tag, status);
        }
      }
      endpoints.push({
        name: `${group.identifier}.${endpoint.identifier}`,
        method: endpoint.method,
        path: endpoint.path,
        middleware,
        hasPayload: endpoint.payload.size > 0,
        failures,
      });
    },
  });
  return endpoints;
};
