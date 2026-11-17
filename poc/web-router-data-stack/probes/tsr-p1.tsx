import { useAtomValue } from "@effect/atom-react";
import { useQuery } from "@tanstack/react-query";
import { createRootRoute, createRoute } from "@tanstack/react-router";
import { AsyncResult } from "effect/reactivity";
import useSWR from "swr";

import { listMembers, type Member, type RequestFailed, type Unauthorized } from "../shared/api";
import { membersAtom } from "../apps/tsr-atom/atoms";

// C1: atom は Effect をそのまま受け、型付きの error を持つ
export const C1 = () => {
  const result: AsyncResult.AsyncResult<Member[], Unauthorized | RequestFailed> = useAtomValue(membersAtom("A"));
  return AsyncResult.matchWithError(result, {
    onInitial: () => null,
    onError: (error) => error._tag,
    onDefect: () => null,
    onSuccess: ({ value }) => value.length,
  });
};

// B0 / C6: queryFn に Effect を渡すと実行されず、data が Effect になる
export const B0 = () => {
  const q = useQuery({ queryKey: ["members", "A"], queryFn: () => listMembers("A") });
  // @ts-expect-error P1(a): Effect を直接は実行しない
  const rows: Member[] | undefined = q.data;
  // @ts-expect-error P1(b): error は Error 型で、tag が無い
  const tag = q.error?._tag;
  return <p>{rows?.length}{tag}</p>;
};

// C3: SWR も同じ
export const C3 = () => {
  const { data, error } = useSWR(["members", "A"], () => listMembers("A"));
  // @ts-expect-error P1(a): Effect を直接は実行しない
  const rows: Member[] | undefined = data;
  const tag: string = error?._tag;
  return <p>{rows?.length}{tag}</p>;
};

// C2: TanStack Router の loader も同じ
const root = createRootRoute();
const membersRoute = createRoute({
  getParentRoute: () => root,
  path: "/probe",
  loader: () => listMembers("A"),
  errorComponent: ({ error }) => {
    // @ts-expect-error P1(b): errorComponent の error は Error 型
    const tag = error._tag;
    return <p>{tag}</p>;
  },
});
// useLoaderData は Register に無い route だと緩く型付くため、route の loaderData 型で確かめる
type C2LoaderData = (typeof membersRoute)["types"]["loaderData"];
// @ts-expect-error P1(a): Effect を直接は実行しない
export const c2Rows: Member[] = null as unknown as C2LoaderData;
