import assert from "node:assert/strict";
import test from "node:test";
import { createManagedAgentControlPlaneFacadeAsyncAdapter } from "./managed-agent-control-plane-facade.js";

test("createManagedAgentControlPlaneFacadeAsyncAdapter 只在 mutation 方法上走 runMutation", async () => {
  const calls: string[] = [];
  const facade = {
    listManagedAgents(ownerPrincipalId: string) {
      calls.push(`list:${ownerPrincipalId}`);
      return {
        organizations: [],
        agents: [],
      };
    },
    dispatchWorkItem() {
      calls.push("dispatch");
      return {
        organization: { organizationId: "org-1" },
        targetAgent: { agentId: "agent-1" },
        workItem: { workItemId: "work-item-1" },
      };
    },
  } as unknown as Parameters<typeof createManagedAgentControlPlaneFacadeAsyncAdapter>[0];
  const adapted = createManagedAgentControlPlaneFacadeAsyncAdapter(facade, {
    runMutation: async (mutation) => {
      calls.push("runMutation");
      return await mutation();
    },
  });

  await adapted.listManagedAgents("principal-owner");
  await adapted.dispatchWorkItem({} as never);

  assert.deepEqual(calls, [
    "list:principal-owner",
    "runMutation",
    "dispatch",
  ]);
});
