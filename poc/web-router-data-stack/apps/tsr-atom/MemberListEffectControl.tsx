import { Effect } from "effect";
import { useEffect, useState } from "react";

import { listMembers, type Member } from "../../shared/api";

// 対照: 今の web/src/membership/pages/Members.tsx と同じく、古い応答を捨てない useEffect 取得
export const MemberListEffectControl = ({ companyId }: { companyId: string }) => {
  const [members, setMembers] = useState<Member[]>([]);
  const [shownFor, setShownFor] = useState<string | null>(null);
  useEffect(() => {
    setMembers([]);
    void Effect.runPromise(listMembers(companyId)).then((rows) => {
      setMembers(rows);
      setShownFor(companyId);
    });
  }, [companyId]);
  return (
    <ul>
      {members.map((m) => (
        <li key={m.user_id} data-company={shownFor ?? ""}>
          {m.name}
        </li>
      ))}
    </ul>
  );
};
