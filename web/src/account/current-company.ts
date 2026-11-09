import { Array, Effect, Number, Option, Schema, String } from "effect";
import { Command, Submodel, type Update } from "foldkit";
import type { Html, HtmlBuilder } from "foldkit/html";
import { defineMessageUnion } from "foldkit/message";
import { defineTaggedUnion } from "foldkit/schema";
import { modifyFields } from "foldkit/struct";
import { Building2 } from "lucide";

import { OrgCodeSchema } from "@core/company/company-contract";
import { orgCodeLabelJa } from "@core/company/org-code";
import { RoleSchema } from "@core/membership/membership-contract";
import { roleLabelJa } from "@core/membership/role-label";

import { SpaHttpClient } from "../shared/spa-http-client";
import { iconView, spinnerView } from "../shared/ui/icon-view";
import { compactSelectView } from "../shared/ui/select-view";
import { NoticeTone, staleNoticeOf } from "../shared/ui/toast-view";

export const Membership = Schema.Struct({
  companyId: Schema.String,
  companyName: Schema.String,
  orgCode: OrgCodeSchema,
  role: RoleSchema,
});
export type Membership = typeof Membership.Type;

export const CompanyMemberships = Schema.Struct({
  maybeCurrentCompanyId: Schema.Option(Schema.String),
  memberships: Schema.Array(Membership),
});
export type CompanyMemberships = typeof CompanyMemberships.Type;

export const Switching = defineTaggedUnion({
  Idle: {},
  Switching: { companyId: Schema.String },
});

export const Model = Schema.Struct({
  state: CompanyMemberships,
  switching: Switching,
  refreshNumber: Schema.Int,
  appliedRefreshNumber: Schema.Int,
  pendingRefreshCount: Schema.Int,
});
export type Model = typeof Model.Type;

const SwitchCompanyFailure = Schema.Literals(["Forbidden", "Unauthorized", "Unexpected"]);
const RefreshFailure = Schema.Literals(["Unauthorized", "Unexpected"]);

export const Message = defineMessageUnion({
  SelectedCompany: { companyId: Schema.String },
  SucceededSwitchCompany: {},
  FailedSwitchCompany: { failure: SwitchCompanyFailure },
  SucceededRefreshCompanyState: {
    refreshNumber: Schema.Int,
    state: CompanyMemberships,
    maybeDoneText: Schema.Option(Schema.String),
  },
  FailedRefreshCompanyState: {
    refreshNumber: Schema.Int,
    failure: RefreshFailure,
    actionText: Schema.String,
  },
});
export type Message = typeof Message.Type;

export const OutMessage = defineMessageUnion({
  Notified: { tone: NoticeTone, text: Schema.String },
  RequiredSignIn: {},
  RefreshedCompanyState: { maybeDoneText: Schema.Option(Schema.String) },
  UpdatedCurrentCompany: { maybeDoneText: Schema.Option(Schema.String) },
});
export type OutMessage = typeof OutMessage.Type;

export const RefreshTexts = Schema.Struct({
  maybeDoneText: Schema.Option(Schema.String),
  actionText: Schema.String,
});
export type RefreshTexts = typeof RefreshTexts.Type;

const SWITCH_FAILED = "事業所を切り替えられませんでした。";

const AFTER_SWITCH: RefreshTexts = {
  maybeDoneText: Option.none(),
  actionText: "事業所を切り替えました",
};

export const readCompanyState = Effect.gen(function* () {
  const client = yield* SpaHttpClient;
  const state = yield* client.account.memberships();
  return {
    maybeCurrentCompanyId: Option.fromNullishOr(state.current_company_id),
    memberships: state.memberships.map((membership) => ({
      companyId: membership.company_id,
      companyName: membership.company_name,
      orgCode: membership.company_org_code,
      role: membership.role,
    })),
  } satisfies CompanyMemberships;
});

const failedSwitchCompany = (failure: typeof SwitchCompanyFailure.Type) => () =>
  Effect.succeed(Message.FailedSwitchCompany({ failure }));

export const SwitchCompany = Command.define("SwitchCompany", {
  args: { companyId: Schema.String },
  messages: [Message.SucceededSwitchCompany, Message.FailedSwitchCompany],
  execute: ({ companyId }) =>
    Effect.gen(function* () {
      const client = yield* SpaHttpClient;
      yield* client.account.switchCompany({ payload: { company_id: companyId } });
      return Message.SucceededSwitchCompany();
    }).pipe(
      Effect.catchTags({
        Forbidden: failedSwitchCompany("Forbidden"),
        Unauthorized: failedSwitchCompany("Unauthorized"),
        HttpClientError: failedSwitchCompany("Unexpected"),
        SchemaError: failedSwitchCompany("Unexpected"),
      }),
    ),
});

export const RefreshCompanyState = Command.define("RefreshCompanyState", {
  args: { refreshNumber: Schema.Int, texts: RefreshTexts },
  messages: [Message.SucceededRefreshCompanyState, Message.FailedRefreshCompanyState],
  execute: ({ refreshNumber, texts }) => {
    const failedRefresh = (failure: typeof RefreshFailure.Type) => () =>
      Effect.succeed(
        Message.FailedRefreshCompanyState({ refreshNumber, failure, actionText: texts.actionText }),
      );
    return readCompanyState.pipe(
      Effect.map((state) =>
        Message.SucceededRefreshCompanyState({
          refreshNumber,
          state,
          maybeDoneText: texts.maybeDoneText,
        }),
      ),
      Effect.catchTags({
        Unauthorized: failedRefresh("Unauthorized"),
        HttpClientError: failedRefresh("Unexpected"),
        SchemaError: failedRefresh("Unexpected"),
      }),
    );
  },
});

export const init = (state: CompanyMemberships): Model => ({
  state,
  switching: Switching.Idle(),
  refreshNumber: 0,
  appliedRefreshNumber: 0,
  pendingRefreshCount: 0,
});

export const maybeCurrentMembership = (state: CompanyMemberships): Option.Option<Membership> =>
  Option.flatMap(state.maybeCurrentCompanyId, (companyId) =>
    Array.findFirst(state.memberships, (membership) => membership.companyId === companyId),
  );

const isSwitching = (model: Model): boolean => Switching.guards.Switching(model.switching);

export const isRefreshing = (model: Model): boolean => model.pendingRefreshCount > 0;

export const isBusy = (model: Model): boolean => isSwitching(model) || isRefreshing(model);

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage, SpaHttpClient>;

export const refresh = (model: Model, texts: RefreshTexts): UpdateReturn => {
  const requested = modifyFields(model, {
    refreshNumber: Number.increment,
    pendingRefreshCount: Number.increment,
  });
  return {
    model: requested,
    commands: [RefreshCompanyState({ refreshNumber: requested.refreshNumber, texts })],
  };
};

const replaceState = (
  model: Model,
  state: CompanyMemberships,
  maybeDoneText: Option.Option<string>,
): UpdateReturn => ({
  model: modifyFields(model, { state: () => state }),
  outMessage: Option.makeEquivalence(String.Equivalence)(
    model.state.maybeCurrentCompanyId,
    state.maybeCurrentCompanyId,
  )
    ? OutMessage.RefreshedCompanyState({ maybeDoneText })
    : OutMessage.UpdatedCurrentCompany({ maybeDoneText }),
});

export const switchTo = (model: Model, companyId: string): UpdateReturn =>
  isSwitching(model) || Option.contains(model.state.maybeCurrentCompanyId, companyId)
    ? { model }
    : {
        model: modifyFields(model, { switching: () => Switching.Switching({ companyId }) }),
        commands: [SwitchCompany({ companyId })],
      };

const isLatestRefresh = (model: Model, refreshNumber: number) =>
  refreshNumber === model.refreshNumber;

const isNewerThanApplied = (model: Model, refreshNumber: number) =>
  refreshNumber > model.appliedRefreshNumber;

const decrementPendingRefresh = (model: Model): Model =>
  modifyFields(model, { pendingRefreshCount: Number.decrement });

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    SelectedCompany: ({ companyId }) => switchTo(model, companyId),
    SucceededSwitchCompany: () =>
      refresh(modifyFields(model, { switching: () => Switching.Idle() }), AFTER_SWITCH),
    FailedSwitchCompany: ({ failure }) => ({
      model: modifyFields(model, { switching: () => Switching.Idle() }),
      outMessage:
        failure === "Unauthorized"
          ? OutMessage.RequiredSignIn()
          : OutMessage.Notified({ tone: "Error", text: SWITCH_FAILED }),
    }),
    SucceededRefreshCompanyState: ({ refreshNumber, state, maybeDoneText }) =>
      isNewerThanApplied(model, refreshNumber)
        ? replaceState(
            modifyFields(model, {
              appliedRefreshNumber: () => refreshNumber,
              pendingRefreshCount: Number.decrement,
            }),
            state,
            maybeDoneText,
          )
        : {
            model: decrementPendingRefresh(model),
            outMessage: OutMessage.RefreshedCompanyState({ maybeDoneText }),
          },
    FailedRefreshCompanyState: ({ refreshNumber, failure, actionText }) =>
      !isLatestRefresh(model, refreshNumber)
        ? { model: decrementPendingRefresh(model) }
        : {
            model: decrementPendingRefresh(model),
            outMessage:
              failure === "Unauthorized"
                ? OutMessage.RequiredSignIn()
                : OutMessage.Notified({ tone: "Error", text: staleNoticeOf(actionText) }),
          },
  });

const SWITCHER_ID = "current-company-switcher";

const membershipSummary = (membership: Membership): string =>
  `${orgCodeLabelJa(membership.orgCode)} ・ ${roleLabelJa(membership.role)}`;

type ViewInputs = Readonly<{ isBlocked: boolean }>;

const switcherView = (
  model: Model,
  current: Membership,
  isBlocked: boolean,
  h: HtmlBuilder<Message>,
): ReadonlyArray<Html> =>
  Array.match(Array.drop(model.state.memberships, 1), {
    onEmpty: () => [
      h.p([h.Class("mt-1 text-sm font-medium text-foreground")], [current.companyName]),
    ],
    onNonEmpty: () => [
      h.div(
        [h.Class("mt-1.5 flex items-center gap-2")],
        [
          compactSelectView(
            {
              id: SWITCHER_ID,
              ariaLabel: "事業所を切り替え",
              title: current.companyName,
              value: current.companyId,
              options: model.state.memberships.map((membership) => ({
                value: membership.companyId,
                label: membership.companyName,
              })),
              isDisabled: isSwitching(model) || isBlocked,
              onChange: (companyId) => Message.SelectedCompany({ companyId }),
            },
            h,
          ),
          ...(isSwitching(model)
            ? [h.span([h.Class("size-4 text-muted-foreground")], [spinnerView(h)])]
            : []),
        ],
      ),
    ],
  });

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, { isBlocked }, h) =>
  Option.match(maybeCurrentMembership(model.state), {
    onNone: () => h.empty,
    onSome: (current) =>
      h.div(
        [h.Class("mb-3 rounded-md border border-border bg-muted/40 p-3")],
        [
          h.div(
            [h.Class("flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-3.5")],
            [iconView(Building2, h), "現在の事業所"],
          ),
          ...switcherView(model, current, isBlocked, h),
          h.p([h.Class("mt-1 text-xs text-muted-foreground")], [membershipSummary(current)]),
        ],
      ),
  }),
);
