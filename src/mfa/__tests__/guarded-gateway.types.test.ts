import { describe, expect, test } from "bun:test";
import type { GuardedGatewayFactory, GuardHold } from "../registration/ports";

// evidence-gating の型 tripwire (設計: AC-003 / AC-004)。@ts-expect-error は「エラーが出ること」を
// 固定する — 将来 brand や factory 署名が緩んでエラーが消えると、unused directive として
// typecheck が落ちる (両方向の検出)。
// wiring を値 import しない — better-auth の実構築をこの静的 tripwire に持ち込まない
// (wiring.guardedGateway は GuardedGatewayFactory 注釈付きなので型面の契約は同一)。
declare const factory: GuardedGatewayFactory;

// AC-003: GuardedGatewayFactory は GuardHold なしで呼べない (呼べるのは hold を持つ runTransition だけ)。
function _factoryRequiresHold(): void {
  // @ts-expect-error hold (資格の証憑) なしで遷移内窓口は作れない
  factory();
}

// AC-004: GuardHold は素の object literal から構成できない (生成点は acquireRegistrationGuard のみ)。
function _holdCannotBeForged(): GuardHold {
  // @ts-expect-error brand が無いため literal は GuardHold にならない
  const forged: GuardHold = {
    userId: "user-1",
    token: "token-1",
    operation: "enroll",
    snapshot: { user: "absent" },
  };
  return forged;
}

describe("guarded gateway type tripwires", () => {
  test("AC-003/AC-004 の @ts-expect-error 式が typecheck を通過している (このファイルが実行できること自体が証跡)", () => {
    // 実行時には何も呼ばない — 上の関数は typecheck 専用で未呼び出しのまま。
    expect(typeof _factoryRequiresHold).toBe("function");
    expect(typeof _holdCannotBeForged).toBe("function");
  });
});
