export interface FeishuVerificationScenario {
  id:
    | "direct_text_takeover"
    | "mixed_recovery"
    | "real_prompt_probe"
    | "manual_ab_acceptance"
    | "session_rebind"
    | "duplicate_or_stale_ignore"
    | "diagnostic_failure_branches";
  layer: "journey" | "service" | "cli";
  label: string;
  command: string;
  why: string;
}

export const FEISHU_FIXED_VERIFICATION_MATRIX: FeishuVerificationScenario[] = [
  {
    id: "direct_text_takeover",
    layer: "journey",
    label: "Web -> 飞书 direct-text takeover",
    command: "node --test --import tsx src/server/http-feishu-journey.test.ts",
    why: "锁住最常用的跨端 waiting user-input 接管金路径。",
  },
  {
    id: "mixed_recovery",
    layer: "journey",
    label: "approval -> user-input -> 飞书 direct-text takeover",
    command: "node --test --import tsx src/server/http-feishu-journey.test.ts",
    why: "锁住 approval 与 user-input 混合恢复的真实主链路。",
  },
  {
    id: "real_prompt_probe",
    layer: "cli",
    label: "真实业务 prompt 低成本探针",
    command: "./themis doctor smoke web",
    why: "固定真实 Web / HTTP prompt -> task.action_required -> completed 的低成本复跑入口。",
  },
  {
    id: "manual_ab_acceptance",
    layer: "journey",
    label: "doctor smoke feishu + 手工 A/B 接力验收",
    command: "./themis doctor smoke feishu",
    why: "把飞书最后一跳固定在正式 smoke 入口和手工 A/B 剧本里复验，不伪装成全自动 E2E。",
  },
  {
    id: "session_rebind",
    layer: "service",
    label: "/use 切会话后的 waiting action 绑定",
    command: "node --test --import tsx src/channels/feishu/service.test.ts",
    why: "防止飞书切回目标会话后串错 session 或 principal。",
  },
  {
    id: "duplicate_or_stale_ignore",
    layer: "service",
    label: "duplicate / stale message 忽略",
    command: "node --test --import tsx src/channels/feishu/service.test.ts",
    why: "防止真实飞书环境里的旧消息或重复消息污染主链路。",
  },
  {
    id: "diagnostic_failure_branches",
    layer: "cli",
    label: "submit_failed / blocked_by_approval / ambiguous 诊断分支",
    command: "node --test --import tsx src/diagnostics/feishu-diagnostics.test.ts src/cli/doctor-cli.test.ts",
    why: "保证 `doctor feishu` 对常见失败有可执行判断。",
  },
];

export const FEISHU_RERUN_SEQUENCE = [
  "./themis doctor feishu",
  "./themis doctor smoke web",
  "./themis doctor smoke feishu",
] as const;

const FEISHU_SMOKE_NEXT_STEP_PREFIXES = [
  "建议先运行：",
  "再运行：",
  "最后运行：",
] as const;

export function buildFeishuSmokeNextSteps(): string[] {
  return FEISHU_RERUN_SEQUENCE.map((command, index) => {
    const prefix = FEISHU_SMOKE_NEXT_STEP_PREFIXES[index];

    if (index === FEISHU_RERUN_SEQUENCE.length - 1) {
      return `${prefix}${command}，并按文档里的 A/B 手工路径继续接力。`;
    }

    return `${prefix}${command}`;
  });
}
