import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { MemberListEffectControl } from "./MemberListEffectControl";
import { companyStateAtom, membersAtom, removeMemberAtom, switchCompanyAtom } from "./atoms";

declare global {
  interface Window {
    __membersRenders?: number;
  }
}

const MemberList = ({ companyId }: { companyId: string }) => {
  const result = useAtomValue(membersAtom(companyId));
  const remove = useAtomSet(removeMemberAtom);
  return AsyncResult.matchWithError(result, {
    onInitial: () => <p role="status">読み込み中…</p>,
    onError: (error) => (
      <p role="alert">{error._tag === "Unauthorized" ? "ログインし直してください" : `取得に失敗しました (${error.status})`}</p>
    ),
    onDefect: () => <p role="alert">予期しないエラー</p>,
    onSuccess: ({ value }) => (
      <ul>
        {value.map((m) => (
          <li key={m.user_id} data-company={companyId}>
            {m.name}
            <button type="button" onClick={() => remove({ companyId, userId: m.user_id })}>
              削除 {m.name}
            </button>
          </li>
        ))}
      </ul>
    ),
  });
};

export const Members = () => {
  window.__membersRenders = (window.__membersRenders ?? 0) + 1;
  const state = useAtomValue(companyStateAtom);
  const switchCompany = useAtomSet(switchCompanyAtom);
  if (!AsyncResult.isSuccess(state)) return <p role="status">読み込み中…</p>;
  const { current_company_id, memberships } = state.value;
  return (
    <div>
      {memberships.map((m) => (
        <button key={m.company_id} type="button" onClick={() => switchCompany(m.company_id)}>
          切替 {m.company_name}
        </button>
      ))}
      <p data-testid="current">{current_company_id}</p>
      {current_company_id && (import.meta.env.VITE_CONTROL ? <MemberListEffectControl companyId={current_company_id} /> : <MemberList companyId={current_company_id} />)}
    </div>
  );
};
