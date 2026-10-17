# testing

試験の環境 (consumer の e2e と手元の確認) だけで動く試験 API と、その entry `testing/server.ts` を置く。

## 境界

- `src/` は `testing/` を import できない。root の `tsconfig.json` は composite で `testing/` を含まないので、import すると typecheck が TS6307 で落ちる。`testing/` の typecheck は `testing/tsconfig.json` で行う。
- `testing/` から `src/` への import はよい。

## 静的な検査

- `__tests__/containment.test.ts`: 資格情報なしに user を作る `AuthApi.createUser` の呼び手が、試験の利用者を作る use-case だけであること
- `__tests__/testing-server.test.ts`: 試験用の entry が `APP_ENV=production` で起動を拒み、本番の worker と同じ app に試験 API の route が無いこと
- `__tests__/default-company-contract.test.ts`: 試験の module で現在の事業所を書き換える呼び手が決まっていて、試験の利用者も契約を満たすこと
