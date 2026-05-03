import assert from "node:assert/strict";
import test from "node:test";
import type { RuntimeDiagnosticsSummary } from "./runtime-diagnostics.js";
import type { AllSmokeResult } from "./runtime-smoke.js";
import { summarizeReleaseReadiness, type ReleaseDocumentationStatus } from "./release-readiness.js";

function createDiagnosticsSummary(errorHotspots: Array<{ title: string; nextStep?: string }> = []): RuntimeDiagnosticsSummary {
  return {
    generatedAt: "2026-04-05T08:00:00.000Z",
    workingDirectory: "/tmp/themis-release",
    auth: {
      defaultCodexHome: "/tmp/.codex",
      authFilePath: "/tmp/.codex/auth.json",
      authFileExists: true,
      snapshotAuthenticated: true,
    },
    provider: {
      activeMode: "auth",
      providerCount: 0,
      providerIds: [],
    },
    context: {
      files: [],
    },
    memory: {
      files: [],
    },
    overview: {
      primaryFocus: errorHotspots[0]
        ? {
            id: "error-hotspot",
            scope: "service",
            severity: "error",
            title: errorHotspots[0].title,
            summary: errorHotspots[0].title,
            nextStep: errorHotspots[0].nextStep ?? "./themis doctor",
          }
        : null,
      hotspots: errorHotspots.map((item, index) => ({
        id: `error-hotspot-${index}`,
        scope: "service" as const,
        severity: "error" as const,
        title: item.title,
        summary: item.title,
        nextStep: item.nextStep ?? "./themis doctor",
      })),
      suggestedCommands: errorHotspots.map((item) => item.nextStep ?? "./themis doctor"),
    },
    feishu: {} as RuntimeDiagnosticsSummary["feishu"],
    service: {
      sqlite: {
        path: "/tmp/themis.db",
        exists: true,
      },
      multimodal: {
        available: true,
        sampleWindowSize: 24,
        recentTurnInputCount: 0,
        assetCounts: {
          image: 0,
          document: 0,
        },
        degradationCounts: {
          native: 0,
          losslessTextualization: 0,
          controlledFallback: 0,
          blocked: 0,
          unknown: 0,
        },
        sourceChannelCounts: [],
        runtimeTargetCounts: [],
        warningCodeCounts: [],
        lastTurn: null,
        lastBlockedTurn: null,
      },
      runtimeCatalog: {
        available: false,
        modelCount: 0,
        defaultModel: null,
        providerCapabilities: null,
        runtimeHooks: null,
      },
    },
    mcp: {
      servers: [],
      diagnostics: {
        statusCounts: {
          healthyCount: 0,
          abnormalCount: 0,
          unknownCount: 0,
        },
        serverDiagnoses: [],
        primaryDiagnosis: null,
        recommendedNextSteps: [],
      },
    },
  };
}

function createSmokeResult(ok: boolean): AllSmokeResult {
  return {
    ok,
    web: {
      ok,
      baseUrl: "http://127.0.0.1:3100",
      sessionId: "session-1",
      requestId: "request-1",
      taskId: "task-1",
      actionId: "action-1",
      observedActionRequired: true,
      observedCompleted: ok,
      historyCompleted: ok,
      imageCompileVerified: true,
      imageCompileDegradationLevel: "native",
      imageCompileWarningCodes: [],
      imageCompileMatrixVerified: true,
      imageCompileMatrixImageNative: "transport=yes effective=yes",
      imageCompileMatrixAssetHandling: ["native"],
      documentCompileVerified: true,
      documentCompileDegradationLevel: "controlled_fallback",
      documentCompileWarningCodes: ["DOCUMENT_NATIVE_INPUT_FALLBACK"],
      documentCompileMatrixVerified: true,
      documentCompileMatrixDocumentNative: "transport=no effective=no",
      documentCompileMatrixAssetHandling: ["path_fallback"],
      sharedBoundary: {
        ok: true,
        imagePathBlockedVerified: true,
        imagePathWarningCodes: ["IMAGE_PATH_UNAVAILABLE"],
        documentPathBlockedVerified: true,
        documentPathWarningCodes: ["DOCUMENT_PATH_UNAVAILABLE"],
        textNativeBlockedVerified: true,
        textNativeWarningCodes: ["TEXT_NATIVE_INPUT_REQUIRED"],
        imageNativeBlockedVerified: true,
        imageNativeWarningCodes: ["IMAGE_NATIVE_INPUT_REQUIRED"],
        documentMimeNativeVerified: true,
        documentMimeNativeWarningCodes: [],
        documentMimeFallbackVerified: true,
        documentMimeWarningCodes: ["DOCUMENT_MIME_TYPE_FALLBACK"],
      },
      message: ok ? "web smoke passed" : "web smoke failed",
    },
    feishu: ok
      ? {
          ok: true,
          serviceReachable: true,
          statusCode: 302,
          diagnosisId: "healthy",
          diagnosisSummary: "ok",
          feishuConfigReady: true,
          sessionBindingCount: 1,
          attachmentDraftCount: 0,
          nextSteps: ["./themis doctor feishu"],
          docPath: "docs/feishu/themis-feishu-real-journey-smoke.md",
          message: "feishu smoke passed",
        }
      : null,
    message: ok ? "all good" : "web smoke failed",
  };
}

function createDocumentation(allOk: boolean): ReleaseDocumentationStatus[] {
  return [
    {
      id: "acceptance_matrix",
      title: "发布验收矩阵",
      path: "docs/repository/themis-release-acceptance-matrix.md",
      status: allOk ? "ok" : "missing",
    },
    {
      id: "rollout_and_rollback",
      title: "灰度与回退",
      path: "docs/repository/themis-release-rollout-and-rollback.md",
      status: "ok",
    },
    {
      id: "operator_onboarding",
      title: "值班与 onboarding",
      path: "docs/repository/themis-operator-onboarding.md",
      status: allOk ? "ok" : "missing",
    },
  ];
}

test("summarizeReleaseReadiness 会在基线、smoke 和文档都通过时返回 ok", () => {
  const summary = summarizeReleaseReadiness({
    workingDirectory: "/tmp/themis-release",
    diagnostics: createDiagnosticsSummary(),
    smoke: createSmokeResult(true),
    documentation: createDocumentation(true),
    generatedAt: "2026-04-05T08:30:00.000Z",
  });

  assert.equal(summary.ok, true);
  assert.ok(summary.checks.every((item) => item.status === "pass"));
  assert.equal(summary.acceptanceMatrix.automatedCommands.length > 0, true);
  assert.equal(summary.acceptanceMatrix.feishuScenarioCount > 0, true);
  assert.deepEqual(summary.nextSteps, [
    "按 docs/repository/themis-release-acceptance-matrix.md 完整跑一遍发布前验收。",
    "先在 owner / 小范围飞书群里灰度，再按 docs/repository/themis-release-rollout-and-rollback.md 扩大发布范围。",
  ]);
});

test("summarizeReleaseReadiness 会在存在错误热点、web smoke 失败和文档缺失时返回 fail", () => {
  const summary = summarizeReleaseReadiness({
    workingDirectory: "/tmp/themis-release",
    diagnostics: createDiagnosticsSummary([{ title: "服务不可达" }]),
    smoke: createSmokeResult(false),
    documentation: createDocumentation(false),
    generatedAt: "2026-04-05T08:31:00.000Z",
  });

  assert.equal(summary.ok, false);
  assert.ok(summary.checks.some((item) => item.id === "diagnostics_baseline" && item.status === "fail"));
  assert.ok(summary.checks.some((item) => item.id === "web_smoke" && item.status === "fail"));
  assert.ok(summary.checks.some((item) => item.id === "acceptance_matrix_doc" && item.status === "fail"));
  assert.ok(summary.nextSteps.includes("./themis doctor"));
  assert.ok(summary.nextSteps.includes("./themis doctor smoke web"));
  assert.ok(summary.nextSteps.includes("补齐 docs/repository/themis-release-acceptance-matrix.md"));
  assert.ok(summary.nextSteps.includes("补齐 docs/repository/themis-operator-onboarding.md"));
});
