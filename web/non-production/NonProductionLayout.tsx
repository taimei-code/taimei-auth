import type { ReactNode } from "react";

export const NonProductionLayout = ({ children }: { readonly children: ReactNode }) => (
  <>
    <header className="bg-primary px-6 py-2 text-sm text-primary-foreground">
      <p>
        <strong className="font-semibold">本番以外の環境</strong>
        の画面です。本番の auth ホストにはありません。
      </p>
    </header>
    <main className="flex flex-col items-center gap-6 p-6 md:p-10">{children}</main>
  </>
);
