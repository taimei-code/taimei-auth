import { describe, expect, test } from "bun:test";
import {
  indexOfStepRunning,
  readWorkflow as readWorkflowAs,
} from "../../src/__tests__/config-invariant-helpers";

type WorkflowStep = { run?: string };
type Workflow = {
  on: Record<string, unknown>;
  jobs: Record<string, { if?: string; steps: WorkflowStep[] }>;
};

const readWorkflow = (name: string) => readWorkflowAs<Workflow>(name);

const SMOKE = "scripts/testing-image-smoke.sh";

describe("試験の環境の image と断片は、出す前に断片のとおりに起動して確かめる", () => {
  test("PR の CI の docker job は、image の probe の後に断片で起動してログインまで通す", () => {
    const { steps } = readWorkflow("ci.yml").jobs.docker ?? { steps: [] };
    const probe = indexOfStepRunning(steps, "scripts/docker-smoke.sh dev");

    expect(probe).toBeGreaterThanOrEqual(0);
    expect(indexOfStepRunning(steps, `${SMOKE} smoke-dev`)).toBeGreaterThan(probe);
  });

  test("publish は、main の CI が成功した後か main からの手動の起動でだけ始まる (deploy と同じ条件)", () => {
    const publish = readWorkflow("publish-auth-client.yml");

    expect(Object.keys(publish.on).sort()).toEqual(["workflow_dispatch", "workflow_run"]);
    expect(publish.on.workflow_run).toEqual({
      workflows: ["CI"],
      types: ["completed"],
      branches: ["main"],
    });
    expect(publish.jobs.publish?.if).toBe(readWorkflow("deploy.yml").jobs.deploy?.if);
  });

  test("publish は、image の push と npm publish の前に断片で起動して確かめる", () => {
    const steps = readWorkflow("publish-auth-client.yml").jobs.publish?.steps ?? [];
    const smoke = indexOfStepRunning(steps, SMOKE);

    expect(smoke).toBeGreaterThanOrEqual(0);
    expect(smoke).toBeLessThan(indexOfStepRunning(steps, "docker push"));
    expect(smoke).toBeLessThan(indexOfStepRunning(steps, "npm publish"));
  });
});
