import { Badge } from "../src/shared/ui/badge";
import { Button } from "../src/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../src/shared/ui/card";
import { type AccountPickerProps, PAGE_TITLES, type PageAccount } from "./page-props";

const AccountRow = ({
  account,
  chooseAction,
}: {
  readonly account: PageAccount;
  readonly chooseAction: string;
}) => (
  <li className="space-y-2 py-3">
    <form method="post" action={chooseAction}>
      <Button
        type="submit"
        name="userId"
        value={account.id}
        variant="outline"
        className="h-auto w-full justify-start whitespace-normal py-2 text-left"
      >
        <span className="min-w-0 break-all">
          {account.name} ({account.email})
        </span>
      </Button>
    </form>
    <ul className="flex flex-wrap gap-2">
      {account.companies.map(({ id, name, role }) => (
        <li key={id}>
          <Badge variant="secondary">
            {name}: {role}
          </Badge>
        </li>
      ))}
    </ul>
  </li>
);

export const AccountPickerPage = ({ accounts, chooseAction, signUpHref }: AccountPickerProps) => (
  <Card className="w-full max-w-md">
    <CardHeader>
      <CardTitle>
        <h1>{PAGE_TITLES.AccountPicker}</h1>
      </CardTitle>
      <CardDescription>
        選んだ利用者でログインします。一覧に無い利用者は、
        <Button asChild variant="link" className="h-auto p-0 align-baseline">
          <a href={signUpHref}>新規登録</a>
        </Button>
        で作れます。
      </CardDescription>
    </CardHeader>
    <CardContent>
      <ul className="divide-y">
        {accounts.map((account) => (
          <AccountRow key={account.id} account={account} chooseAction={chooseAction} />
        ))}
      </ul>
    </CardContent>
  </Card>
);
