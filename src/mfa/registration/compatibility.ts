import { registrationApplication } from "./wiring";

// 旧 SPA タブは enrollment_id を送らない。この入口を別ファイルに分離するのは、新しい呼び出し元が
// ID なし経路に乗って識別子照合を迂回するのを防ぐため (移行の第1段階のみ。撤去条件: ADR-0013 §8)。
export const activateLegacy = registrationApplication.activateLegacy;
