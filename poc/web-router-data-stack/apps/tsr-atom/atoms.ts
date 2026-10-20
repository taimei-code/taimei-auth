import { Layer } from "effect";
import { Atom } from "effect/reactivity";

import * as api from "../../shared/api";

const runtime = Atom.runtime(Layer.empty);

export const companyStateAtom = runtime
  .atom(api.getCompanyState)
  .pipe(runtime.factory.withReactivity(["company-state"]));

export const membersAtom = Atom.family((companyId: string) =>
  runtime.atom(api.listMembers(companyId)).pipe(runtime.factory.withReactivity(["members"])),
);

export const switchCompanyAtom = runtime.fn(api.setCurrentCompany, {
  reactivityKeys: ["company-state"],
});

export const removeMemberAtom = runtime.fn(api.removeMember, {
  reactivityKeys: ["company-state", "members"],
});
