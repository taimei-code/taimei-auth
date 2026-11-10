# db/ 境界ルール

- drizzle-kit が管理できない SQL (trigger、VIEW、FUNCTION) は `drizzle/manual/NNNN_*.sql` に 1 ファイルずつ足す。`drizzle/` 直下に置いた手書きの SQL は流れない。`bun run db:migrate-manual` で流し、host から `psql` で流さない。
- `drizzle/manual/` には何度流しても結果が同じ DDL と修復だけを置く。一度だけのデータ移行は `management/` の script にする (ADR-0010)。
