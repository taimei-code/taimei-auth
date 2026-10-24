import { type ReactNode, useState } from "react";
import { Alert } from "../src/shared/ui/alert";
import { Badge } from "../src/shared/ui/badge";
import { Button } from "../src/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/shared/ui/card";
import { Input } from "../src/shared/ui/input";
import { accountsMatching, FILTER_SHOWN_ABOVE_ACCOUNT_COUNT } from "./accounts-matching";
import {
  type DevHomeProps,
  type Destination,
  PAGE_TITLES,
  type PageAccount,
  type Viewer,
} from "./page-props";

const SignedOutMessage = () => (
  <div className="space-y-1">
    <p className="font-medium">ログインしていません</p>
    <p className="text-sm text-muted-foreground">
      下の一覧から利用者を選ぶと、その利用者でログインします。
    </p>
  </div>
);

const SignedInUser = ({
  account,
  signOutAction,
}: {
  readonly account: PageAccount;
  readonly signOutAction: string;
}) => (
  <div className="space-y-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{account.name}</p>
        <p className="break-all text-sm text-muted-foreground">{account.email}</p>
      </div>
      <form method="post" action={signOutAction}>
        <Button type="submit" variant="outline" size="sm">
          ログアウト
        </Button>
      </form>
    </div>
    <dl className="divide-y rounded-md border text-sm" aria-label="所属する事業所と role">
      {account.companies.map(({ id, name, role, isCurrent }) => (
        <div key={id} className="flex items-center justify-between gap-3 px-3 py-2">
          <dt className="flex flex-wrap items-center gap-2">
            {name}
            {isCurrent ? <Badge variant="secondary">現在の事業所</Badge> : null}
          </dt>
          <dd>
            <Badge variant="outline">{role}</Badge>
          </dd>
        </div>
      ))}
    </dl>
  </div>
);

const noticeTextOf = (viewer: Viewer) => {
  if (viewer._tag === "SignedIn")
    return viewer.notice === "JustSignedIn" ? `${viewer.account.name} でログインしました` : null;
  return viewer.notice === "JustSignedOut" ? "ログアウトしました" : null;
};

const ACCOUNT_PAGE_HREF = "/account";

const DestinationLink = ({ destination }: { readonly destination: Destination }) =>
  destination._tag === "Application" ? (
    <div className="space-y-3">
      <dl className="text-sm">
        <dt className="text-muted-foreground">戻り先</dt>
        <dd className="break-all">{destination.redirectUrl}</dd>
      </dl>
      <Button asChild className="w-full">
        <a href={destination.redirectUrl}>アプリケーションに戻る</a>
      </Button>
    </div>
  ) : (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        戻り先のアプリケーションが指定されていないので、taimei-auth のアカウント管理画面を開きます。
      </p>
      <Button asChild className="w-full">
        <a href={ACCOUNT_PAGE_HREF}>アカウント管理画面を開く</a>
      </Button>
    </div>
  );

const AccountRows = ({
  accounts,
  signedInId,
}: {
  readonly accounts: readonly PageAccount[];
  readonly signedInId: string | undefined;
}) => (
  <ul>
    {accounts.map(({ id, email }) => (
      <li key={id}>
        <Button
          type="submit"
          name="userId"
          value={id}
          variant="ghost"
          disabled={id === signedInId}
          className="h-auto w-full justify-between gap-3 whitespace-normal py-2 text-left font-normal disabled:text-muted-foreground disabled:opacity-100"
        >
          <span className="min-w-0 break-all">{email}</span>
          {id === signedInId ? <span className="shrink-0 text-xs">ログイン中</span> : null}
        </Button>
      </li>
    ))}
  </ul>
);

const ListMessage = ({ children }: { readonly children: string }) => (
  <p className="px-4 py-2 text-sm text-muted-foreground">{children}</p>
);

const AccountGroup = ({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) => (
  <fieldset className="space-y-1">
    <legend className="px-4 text-xs font-medium text-muted-foreground">{label}</legend>
    {children}
  </fieldset>
);

const MatchingAccountGroup = ({
  label,
  accounts,
  signedInId,
}: {
  readonly label: string;
  readonly accounts: readonly PageAccount[];
  readonly signedInId: string | undefined;
}) =>
  accounts.length > 0 ? (
    <AccountGroup label={label}>
      <AccountRows accounts={accounts} signedInId={signedInId} />
    </AccountGroup>
  ) : null;

const BROWSER_ACCOUNT_GROUP_LABEL = "この browser でログインした利用者";

const BrowserAccountGroup = ({
  accounts,
  shownAccounts,
  signedInId,
}: {
  readonly accounts: readonly PageAccount[];
  readonly shownAccounts: readonly PageAccount[];
  readonly signedInId: string | undefined;
}) =>
  accounts.length > 0 ? (
    <MatchingAccountGroup
      label={BROWSER_ACCOUNT_GROUP_LABEL}
      accounts={shownAccounts}
      signedInId={signedInId}
    />
  ) : (
    <AccountGroup label={BROWSER_ACCOUNT_GROUP_LABEL}>
      <ListMessage>
        ログインした状態でこの browser の開発者ホームを開くと、その利用者がここに出ます。
      </ListMessage>
    </AccountGroup>
  );

const AccountFilter = ({
  query,
  onQueryChange,
}: {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}) => (
  <search>
    <label htmlFor="account-filter" className="sr-only">
      利用者を絞り込む
    </label>
    <Input
      id="account-filter"
      type="search"
      autoComplete="off"
      placeholder="名前かメールで絞り込む"
      aria-controls="accounts"
      value={query}
      onChange={(event) => onQueryChange(event.target.value)}
    />
  </search>
);

const AccountList = ({
  devAccounts,
  browserAccounts,
  signedInId,
  signInAction,
}: Pick<DevHomeProps, "devAccounts" | "browserAccounts" | "signInAction"> & {
  readonly signedInId: string | undefined;
}) => {
  const [query, setQuery] = useState("");
  const shownDevAccounts = accountsMatching(devAccounts, query);
  const shownBrowserAccounts = accountsMatching(browserAccounts, query);
  return (
    <section className="space-y-3 border-t pt-6" aria-labelledby="accounts-heading">
      <h2 id="accounts-heading" className="text-sm font-medium text-muted-foreground">
        ログインする利用者を選ぶ
      </h2>
      {devAccounts.length + browserAccounts.length > FILTER_SHOWN_ABOVE_ACCOUNT_COUNT ? (
        <AccountFilter query={query} onQueryChange={setQuery} />
      ) : null}
      <form id="accounts" method="post" action={signInAction} className="-mx-4 space-y-3">
        <MatchingAccountGroup
          label="開発用アカウント"
          accounts={shownDevAccounts}
          signedInId={signedInId}
        />
        <BrowserAccountGroup
          accounts={browserAccounts}
          shownAccounts={shownBrowserAccounts}
          signedInId={signedInId}
        />
        {shownDevAccounts.length + shownBrowserAccounts.length === 0 ? (
          <ListMessage>{`「${query}」に一致する利用者はいません。`}</ListMessage>
        ) : null}
      </form>
    </section>
  );
};

export const DevHomePage = ({
  devAccounts,
  browserAccounts,
  viewer,
  destination,
  signInAction,
  signOutAction,
}: DevHomeProps) => {
  const notice = noticeTextOf(viewer);
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1>{PAGE_TITLES.DevHome}</h1>
        </CardTitle>
        <CardDescription>
          ログインする利用者を切り替えて、アプリケーションに戻って確かめます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <section className="space-y-3" aria-labelledby="signed-in">
            <h2 id="signed-in" className="text-sm font-medium text-muted-foreground">
              ログイン中の利用者
            </h2>
            {viewer._tag === "SignedIn" ? (
              <SignedInUser account={viewer.account} signOutAction={signOutAction} />
            ) : (
              <SignedOutMessage />
            )}
          </section>
          {notice === null ? null : (
            <Alert role="status" className="bg-muted font-medium">
              {notice}
            </Alert>
          )}
          <DestinationLink destination={destination} />
        </div>
        <AccountList
          devAccounts={devAccounts}
          browserAccounts={browserAccounts}
          signedInId={viewer._tag === "SignedIn" ? viewer.account.id : undefined}
          signInAction={signInAction}
        />
      </CardContent>
    </Card>
  );
};
