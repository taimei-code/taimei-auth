import { registrationApplication } from "./wiring";

// 旧 SPA (enrollment_id なし) 専用の入口。別ファイルに分離するのは新しい呼び出し元が識別子照合を
// 迂回しないため (移行の第 1 段階のみ。撤去条件: ADR-0013 §8)。
export const activateLegacy = registrationApplication.activateLegacy;
