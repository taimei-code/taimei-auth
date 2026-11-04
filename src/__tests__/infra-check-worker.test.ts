import { describe, expect, test } from "bun:test";
import { servingVersionIds, type WorkerSettings, workerMismatches } from "../../infra/check-worker";

const expected: WorkerSettings = {
  bindings: [
    { name: "HYPERDRIVE", type: "hyperdrive" },
    { name: "AUTH_SECRET", type: "secrets_store_secret" },
  ],
  workersDev: false,
  observability: false,
};

describe("取り込みの前と drift の検出で、Worker の今の設定を stage の表から作った期待と比べる", () => {
  test("期待どおりなら何も報告しない", () => {
    expect(workerMismatches(expected, expected)).toEqual([]);
  });

  test("定義に書き忘れた binding は取り込みの deploy で黙って消えるので、今の設定にあって期待に無い binding を報告する", () => {
    const live = {
      ...expected,
      bindings: [...expected.bindings, { name: "EXTRA", type: "plain_text" }],
    };
    expect(workerMismatches(live, expected)).toEqual([
      "EXTRA (plain_text) is live but not declared",
    ]);
  });

  test("期待にあって今の設定に無い binding を報告する", () => {
    const live = { ...expected, bindings: [{ name: "HYPERDRIVE", type: "hyperdrive" }] };
    expect(workerMismatches(live, expected)).toEqual([
      "AUTH_SECRET (secrets_store_secret) is declared but not live",
    ]);
  });

  test("名前が同じで種類が違う binding を報告する", () => {
    const live = {
      ...expected,
      bindings: [
        { name: "HYPERDRIVE", type: "hyperdrive" },
        { name: "AUTH_SECRET", type: "secret_text" },
      ],
    };
    expect(workerMismatches(live, expected)).toEqual([
      "AUTH_SECRET (secret_text) is live but not declared",
      "AUTH_SECRET (secrets_store_secret) is declared but not live",
    ]);
  });

  test("workers.dev と observability の有無の違いを報告する", () => {
    const live = { ...expected, workersDev: true, observability: true };
    expect(workerMismatches(live, expected)).toEqual([
      "workers.dev is true but declared false",
      "observability is true but declared false",
    ]);
  });

  test("alchemy が足す ALCHEMY_ で始まる binding は比べない", () => {
    const live = {
      ...expected,
      bindings: [...expected.bindings, { name: "ALCHEMY_STACK_NAME", type: "plain_text" }],
    };
    expect(workerMismatches(live, expected)).toEqual([]);
  });
});

describe("比べるのは、今 traffic を受けている deployment の version である", () => {
  test("script の settings は 0% で上げただけの最新の version を返すので、新しい順の先頭の deployment に入っている version をすべて比べる", () => {
    const deployments = [
      { versions: [{ version_id: "gate-at-0" }, { version_id: "current-at-100" }] },
      { versions: [{ version_id: "older" }] },
    ];
    expect(servingVersionIds(deployments)).toEqual(["gate-at-0", "current-at-100"]);
  });

  test("deployment が 1 つも無い Worker は、比べる version が無いので失敗する", () => {
    expect(() => servingVersionIds([])).toThrow();
  });
});
