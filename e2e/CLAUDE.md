# e2e/ 実行と fixture の規則

- 走らせるのは `bun run test:e2e` (1 つなら `bun run test:e2e e2e/<name>.e2e.ts`)。前提は local の Postgres と `.env` である。
- 行を壊す spec は `fixture-names.ts` の `CONSUMABLE_FIXTURES` に名前を足し、その行を壊す test の最初 (どの test も同じ行を壊すなら `beforeEach`) で `reseedFixture` を呼ぶ。壊さない spec は全体の seed の行を使う。
