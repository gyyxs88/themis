import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RuntimeDiagnosticsSummary } from "./runtime-diagnostics.js";
import type { AllSmokeResult } from "./runtime-smoke.js";
import { FEISHU_FIXED_VERIFICATION_MATRIX, FEISHU_RERUN_SEQUENCE } from "./feishu-verification-guide.js";

export type ReleaseDocumentationId =
  | "acceptance_matrix"
  | "rollout_and_rollback"
  | "operator_onboarding";

export interface ReleaseDocumentationStatus {
  id: ReleaseDocumentationId;
  title: string;
  path: string;
  status: "ok" | "missing";
}

export interface ReleaseReadinessCheck {
  id: string;
  title: string;
  status: "pass" | "fail";
  summary: string;
  nextStep: string;
}

export interface ReleaseReadinessAcceptanceMatrix {
  automatedCommands: string[];
  feishuScenarioCount: number;
  rerunSequence: string[];
  manualDocs: string[];
}

export interface ReleaseReadinessSummary {
  generatedAt: string;
  workingDirectory: string;
  ok: boolean;
  documentation: ReleaseDocumentationStatus[];
  acceptanceMatrix: ReleaseReadinessAcceptanceMatrix;
  checks: ReleaseReadinessCheck[];
  nextSteps: string[];
}

export const RELEASE_REQUIRED_DOCUMENTS: Array<{
  id: ReleaseDocumentationId;
  title: string;
  path: string;
}> = [
  {
    id: "acceptance_matrix",
    title: "发布验收矩阵",
    path: "docs/repository/themis-release-acceptance-matrix.md",
  },
  {
    id: "rollout_and_rollback",
    title: "灰度与回退",
    path: "docs/repository/themis-release-rollout-and-rollback.md",
  },
  {
    id: "operator_onboarding",
    title: "值班与 onboarding",
    path: "docs/repository/themis-operator-onboarding.md",
  },
] as const;

export const RELEASE_AUTOMATED_ACCEPTANCE_COMMANDS = [
  "npm run typecheck",
  "node --test --import tsx src/server/http-web-journey.test.ts",
  "node --test --import tsx src/server/http-feishu-journey.test.ts",
  "node --test --import tsx src/channels/feishu/service.test.ts",
  "./themis doctor",
  "./themis doctor smoke web",
  "./themis doctor smoke feishu",
] as const;

const RELEASE_MANUAL_DOCUMENTS = [
  "docs/feishu/themis-feishu-real-journey-smoke.md",
  ...RELEASE_REQUIRED_DOCUMENTS.map((item) => item.path),
] as const;

export function readReleaseDocumentationStatuses(workingDirectory: string): ReleaseDocumentationStatus[] {
  return RELEASE_REQUIRED_DOCUMENTS.map((document) => ({
    ...document,
    status: existsSync(join(workingDirectory, document.path)) ? "ok" : "missing",
  }));
}

export function summarizeReleaseReadiness(input: {
  workingDirectory: string;
  diagnostics: RuntimeDiagnosticsSummary;
  smoke: AllSmokeResult;
  documentation?: ReleaseDocumentationStatus[];
  generatedAt?: string;
}): ReleaseReadinessSummary {
  const documentation = input.documentation ?? readReleaseDocumentationStatuses(input.workingDirectory);
  const errorHotspots = input.diagnostics.overview.hotspots.filter((item) => item.severity === "error");
  const missingDocs = documentation.filter((item) => item.status !== "ok");
  const diagnosticsBaselinePass = errorHotspots.length === 0;
  const webSmokePass = input.smoke.web.ok;
  const feishuSmokePass = input.smoke.feishu?.ok === true;
  const checks: ReleaseReadinessCheck[] = [
    {
      id: "diagnostics_baseline",
      title: "运行诊断基线",
      status: diagnosticsBaselinePass ? "pass" : "fail",
      summary: diagnosticsBaselinePass
        ? "当前 `./themis doctor` 没有 error 级热点，可以进入发布验收。"
        : `仍有 ${errorHotspots.length} 个 error 级热点：${errorHotspots.map((item) => item.title).join(" / ")}`,
      nextStep: "./themis doctor",
    },
    {
      id: "web_smoke",
      title: "真实 Web smoke",
      status: webSmokePass ? "pass" : "fail",
      summary: webSmokePass
        ? "真实 Web / HTTP 主链路 smoke 已通过，`task.action_required -> completed` 正常。"
        : input.smoke.web.message,
      nextStep: "./themis doctor smoke web",
    },
    {
      id: "feishu_smoke",
      title: "飞书 smoke 前置检查",
      status: feishuSmokePass ? "pass" : "fail",
      summary: feishuSmokePass
        ? input.smoke.feishu?.message ?? "飞书 smoke 前置检查已通过。"
        : input.smoke.feishu?.message ?? "Web smoke 未通过，因此本轮发布检查已跳过飞书 smoke。",
      nextStep: input.smoke.feishu?.nextSteps[0] ?? "./themis doctor feishu",
    },
    {
      id: "acceptance_matrix_doc",
      title: "发布验收矩阵文档",
      status: documentation.some((item) => item.id === "acceptance_matrix" && item.status === "ok") ? "pass" : "fail",
      summary: documentation.some((item) => item.id === "acceptance_matrix" && item.status === "ok")
        ? "发布验收矩阵文档已存在，自动化与手工验收入口都有固定落点。"
        : "缺少发布验收矩阵文档，当前没有统一的放量前验收清单。",
      nextStep: documentation.some((item) => item.id === "acceptance_matrix" && item.status === "ok")
        ? "按 docs/repository/themis-release-acceptance-matrix.md 执行发布前验收。"
        : "补齐 docs/repository/themis-release-acceptance-matrix.md",
    },
    {
      id: "rollout_and_rollback_doc",
      title: "灰度与回退文档",
      status: documentation.some((item) => item.id === "rollout_and_rollback" && item.status === "ok") ? "pass" : "fail",
      summary: documentation.some((item) => item.id === "rollout_and_rollback" && item.status === "ok")
        ? "灰度范围、观察窗口和回退动作都已有明确文档。"
        : "缺少灰度 / 回退文档，故障时还没有统一的放量与止损剧本。",
      nextStep: documentation.some((item) => item.id === "rollout_and_rollback" && item.status === "ok")
        ? "按 docs/repository/themis-release-rollout-and-rollback.md 执行灰度与回退。"
        : "补齐 docs/repository/themis-release-rollout-and-rollback.md",
    },
    {
      id: "operator_onboarding_doc",
      title: "值班与 onboarding 文档",
      status: documentation.some((item) => item.id === "operator_onboarding" && item.status === "ok") ? "pass" : "fail",
      summary: documentation.some((item) => item.id === "operator_onboarding" && item.status === "ok")
        ? "新人和值班同学已经有固定 onboarding 文档可按图执行。"
        : "缺少 operator onboarding 文档，新人接手与值班交接还不成体系。",
      nextStep: documentation.some((item) => item.id === "operator_onboarding" && item.status === "ok")
        ? "持续维护 docs/repository/themis-operator-onboarding.md。"
        : "补齐 docs/repository/themis-operator-onboarding.md",
    },
  ];

  const ok = checks.every((item) => item.status === "pass");
  const nextSteps = ok
    ? [
        "按 docs/repository/themis-release-acceptance-matrix.md 完整跑一遍发布前验收。",
        "先在 owner / 小范围飞书群里灰度，再按 docs/repository/themis-release-rollout-and-rollback.md 扩大发布范围。",
      ]
    : Array.from(new Set(checks.filter((item) => item.status === "fail").map((item) => item.nextStep)));

  if (!ok && missingDocs.length > 0) {
    for (const document of missingDocs) {
      const step = `补齐 ${document.path}`;
      if (!nextSteps.includes(step)) {
        nextSteps.push(step);
      }
    }
  }

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workingDirectory: input.workingDirectory,
    ok,
    documentation,
    acceptanceMatrix: {
      automatedCommands: [...RELEASE_AUTOMATED_ACCEPTANCE_COMMANDS],
      feishuScenarioCount: FEISHU_FIXED_VERIFICATION_MATRIX.length,
      rerunSequence: [...FEISHU_RERUN_SEQUENCE],
      manualDocs: [...RELEASE_MANUAL_DOCUMENTS],
    },
    checks,
    nextSteps,
  };
}
