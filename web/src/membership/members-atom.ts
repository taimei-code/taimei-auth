import { Effect } from "effect";
import { Atom } from "effect/reactivity";

import { listInvitations, type PendingInvitation } from "../invitation/invitation-api";
import { atomRuntime } from "../shared/atom-runtime";
import { fromRequestJson } from "../shared/request-json";
import { listMembers, type Member } from "./membership-api";

// key が事業所ごとに別の atom なので、切替前の事業所の応答は今の画面に届かない
export const membersOf = Atom.family((companyId: string | null) =>
  atomRuntime.atom(
    companyId === null
      ? Effect.succeed<Member[]>([])
      : fromRequestJson(() => listMembers(companyId)),
  ),
);

// 招待一覧は ADMIN 未満だと 403 になるため、管理できない人は null を渡す
export const pendingInvitationsOf = Atom.family((companyId: string | null) =>
  atomRuntime.atom(
    companyId === null
      ? Effect.succeed<PendingInvitation[]>([])
      : fromRequestJson(() => listInvitations(companyId)),
  ),
);
