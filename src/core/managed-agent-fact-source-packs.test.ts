import assert from "node:assert/strict";
import test from "node:test";
import {
  applyManagedAgentReadOnlyFactSourcePacks,
  normalizeManagedAgentReadOnlyFactSourcePackIds,
} from "./managed-agent-fact-source-packs.js";

test("read-only fact source packs enrich context and runtime contract", () => {
  const enriched = applyManagedAgentReadOnlyFactSourcePacks({
    readOnlyFactSourcePacks: normalizeManagedAgentReadOnlyFactSourcePackIds([
      "cloudflare_readonly",
      "operations_ledger_readonly",
    ]),
    contextPacket: {
      scope: "weekly-ops-inspection",
    },
    runtimeProfileSnapshot: {
      model: "gpt-5.5",
    },
  });

  assert.equal(enriched.appliedFactSources.length, 2);
  assert.deepEqual(enriched.runtimeProfileSnapshot?.secretEnvRefs, [{
    envName: "CLOUDFLARE_API_TOKEN",
    secretRef: "cloudflare-readonly-token",
    required: true,
  }]);
  assert.equal(enriched.runtimeProfileSnapshot?.sandboxMode, "read-only");
  assert.equal(enriched.runtimeProfileSnapshot?.networkAccessEnabled, true);

  const context = enriched.contextPacket as {
    scope?: string;
    safety?: string;
    readOnlyFactSourcePackIds?: string[];
    readOnlyFactSources?: Array<{ id?: string; toolNames?: string[] }>;
  };
  assert.equal(context.scope, "weekly-ops-inspection");
  assert.equal(context.safety, "read_only_only_no_writes");
  assert.deepEqual(context.readOnlyFactSourcePackIds, [
    "cloudflare_readonly",
    "operations_ledger_readonly",
  ]);
  assert.ok(context.readOnlyFactSources?.some((source) => source.id === "operations_ledger_readonly"
    && source.toolNames?.includes("get_operations_boss_view")));
});

test("read-only fact source packs reject write-capable runtime snapshots", () => {
  assert.throws(
    () => applyManagedAgentReadOnlyFactSourcePacks({
      readOnlyFactSourcePacks: ["cloudflare_readonly"],
      runtimeProfileSnapshot: {
        sandboxMode: "danger-full-access",
      },
    }),
    /sandboxMode=read-only/,
  );
});

test("read-only fact source packs reject unsupported pack ids", () => {
  assert.throws(
    () => normalizeManagedAgentReadOnlyFactSourcePackIds(["unknown_pack"]),
    /Unsupported read-only fact source pack/,
  );
});
