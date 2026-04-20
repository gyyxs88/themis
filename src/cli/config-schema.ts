export interface ProjectConfigDefinition {
  key: string;
  section: string;
  description: string;
  defaultValue?: string;
  secret?: boolean;
  note?: string;
}

export const PROJECT_CONFIG_DEFINITIONS: ProjectConfigDefinition[] = [
  {
    key: "THEMIS_HOST",
    section: "服务监听",
    description: "LAN Web 服务监听地址。",
    defaultValue: "0.0.0.0",
  },
  {
    key: "THEMIS_PORT",
    section: "服务监听",
    description: "LAN Web 服务端口。",
    defaultValue: "3100",
  },
  {
    key: "THEMIS_TASK_TIMEOUT_MS",
    section: "服务监听",
    description: "单个任务超时时间，单位毫秒。",
    defaultValue: "300000",
  },
  {
    key: "THEMIS_PLATFORM_BASE_URL",
    section: "服务监听",
    description: "可选。启用主 Themis Gateway 读模式时要连接的平台 base URL。",
    note: "只有与 THEMIS_PLATFORM_OWNER_PRINCIPAL_ID / THEMIS_PLATFORM_WEB_ACCESS_TOKEN 同时配置时才生效。",
  },
  {
    key: "THEMIS_PLATFORM_OWNER_PRINCIPAL_ID",
    section: "服务监听",
    description: "可选。主 Themis 读取平台事实时使用的平台 owner principalId。",
    note: "只有与 THEMIS_PLATFORM_BASE_URL / THEMIS_PLATFORM_WEB_ACCESS_TOKEN 同时配置时才生效。",
  },
  {
    key: "THEMIS_PLATFORM_WEB_ACCESS_TOKEN",
    section: "服务监听",
    description: "可选。主 Themis 读取平台事实时使用的平台 Web Access token。",
    secret: true,
    note: "只有与 THEMIS_PLATFORM_BASE_URL / THEMIS_PLATFORM_OWNER_PRINCIPAL_ID 同时配置时才生效。",
  },
  {
    key: "THEMIS_MANAGED_AGENT_CONTROL_PLANE_DATABASE_FILE",
    section: "服务监听",
    description: "可选。SQLite driver 下把 managed-agent 共享控制面指到独立文件；MySQL driver 下则作为本地 shared cache SQLite 文件。",
    note: "未配置时，sqlite driver 仍默认复用 infra/local/themis.db；mysql driver 默认落到 infra/platform/control-plane.db。",
  },
  {
    key: "THEMIS_PLATFORM_CONTROL_PLANE_DRIVER",
    section: "服务监听",
    description: "平台层 shared control plane 驱动。",
    defaultValue: "sqlite",
    note: "当前支持 sqlite 或 mysql；独立平台进程建议显式设为 mysql。",
  },
  {
    key: "THEMIS_PLATFORM_MYSQL_URI",
    section: "服务监听",
    description: "可选。平台层 MySQL 连接 URI。",
    secret: true,
    note: "配置后优先于 HOST/PORT/USER/PASSWORD 组合。",
  },
  {
    key: "THEMIS_PLATFORM_MYSQL_HOST",
    section: "服务监听",
    description: "可选。平台层 MySQL 主机地址。",
    defaultValue: "127.0.0.1",
  },
  {
    key: "THEMIS_PLATFORM_MYSQL_PORT",
    section: "服务监听",
    description: "可选。平台层 MySQL 端口。",
    defaultValue: "3306",
  },
  {
    key: "THEMIS_PLATFORM_MYSQL_USER",
    section: "服务监听",
    description: "可选。平台层 MySQL 用户名。",
    defaultValue: "root",
  },
  {
    key: "THEMIS_PLATFORM_MYSQL_PASSWORD",
    section: "服务监听",
    description: "可选。平台层 MySQL 密码。",
    secret: true,
  },
  {
    key: "THEMIS_PLATFORM_MYSQL_DATABASE",
    section: "服务监听",
    description: "平台层 MySQL 数据库名。",
    note: "当 THEMIS_PLATFORM_CONTROL_PLANE_DRIVER=mysql 时必填。",
  },
  {
    key: "THEMIS_PLATFORM_MYSQL_CONNECTION_LIMIT",
    section: "服务监听",
    description: "可选。平台层 MySQL 连接池大小。",
    defaultValue: "5",
  },
  {
    key: "THEMIS_BUILD_COMMIT",
    section: "版本更新",
    description: "可选。显式标记当前构建提交；非 git 部署或需要固定版本比较时使用。",
  },
  {
    key: "THEMIS_BUILD_BRANCH",
    section: "版本更新",
    description: "可选。与 THEMIS_BUILD_COMMIT 配套记录当前构建分支。",
  },
  {
    key: "THEMIS_UPDATE_REPO",
    section: "版本更新",
    description: "更新源 GitHub 仓库，支持 owner/repo、HTTPS URL 或 SSH URL。",
    defaultValue: "gyyxs88/themis",
  },
  {
    key: "THEMIS_UPDATE_CHANNEL",
    section: "版本更新",
    description: "更新渠道。",
    defaultValue: "branch",
    note: "当前仅支持 branch（默认分支头提交）或 release（GitHub latest release）。",
  },
  {
    key: "THEMIS_UPDATE_DEFAULT_BRANCH",
    section: "版本更新",
    description: "更新源默认分支。",
    defaultValue: "main",
  },
  {
    key: "THEMIS_UPDATE_SYSTEMD_SERVICE",
    section: "版本更新",
    description: "受控升级成功后默认要重启的 systemd --user 服务名。",
    defaultValue: "themis-prod.service",
  },
  {
    key: "THEMIS_GITHUB_TOKEN",
    section: "版本更新",
    description: "可选。用于提高 GitHub 更新检查配额或访问受限更新源。",
    secret: true,
  },
  {
    key: "CODEX_HOME",
    section: "Codex 认证",
    description: "显式指定 Codex 认证目录；未配置时使用 ~/.codex。",
  },
  {
    key: "CODEX_API_KEY",
    section: "Codex 认证",
    description: "可选。直接用 API Key 作为 Codex 认证入口。",
    secret: true,
    note: "如果不配，也可以在 Web 里做 ChatGPT 浏览器登录或设备码登录。",
  },
  {
    key: "FEISHU_APP_ID",
    section: "飞书渠道",
    description: "飞书企业自建应用的 App ID。",
  },
  {
    key: "FEISHU_APP_SECRET",
    section: "飞书渠道",
    description: "飞书企业自建应用的 App Secret。",
    secret: true,
  },
  {
    key: "FEISHU_LOG_LEVEL",
    section: "飞书渠道",
    description: "飞书 SDK 日志级别。",
    defaultValue: "info",
  },
  {
    key: "FEISHU_USE_ENV_PROXY",
    section: "飞书渠道",
    description: "是否让飞书 SDK 继承 HTTP_PROXY / HTTPS_PROXY。",
    defaultValue: "0",
  },
  {
    key: "FEISHU_PROGRESS_FLUSH_TIMEOUT_MS",
    section: "飞书渠道",
    description: "飞书正文主消息的 soft flush 节拍，单位毫秒；到点会优先截到句末或空行。",
    defaultValue: "20000",
  },
  {
    key: "THEMIS_OPENAI_COMPAT_BASE_URL",
    section: "第三方兼容 Provider",
    description: "兼容 OpenAI provider 的 base URL。",
    note: "这组配置也可以在 Web 设置页里维护并写入 SQLite。",
  },
  {
    key: "THEMIS_OPENAI_COMPAT_API_KEY",
    section: "第三方兼容 Provider",
    description: "兼容 OpenAI provider 的 API Key。",
    secret: true,
  },
  {
    key: "THEMIS_OPENAI_COMPAT_MODEL",
    section: "第三方兼容 Provider",
    description: "默认模型名。",
  },
  {
    key: "THEMIS_OPENAI_COMPAT_NAME",
    section: "第三方兼容 Provider",
    description: "供应商显示名。",
    note: "只有在完整配置 baseUrl / apiKey / model 时，这个字段才会参与生效；未填写时运行时默认显示为 OpenAI-Compatible Provider。",
  },
  {
    key: "THEMIS_OPENAI_COMPAT_ENDPOINT_CANDIDATES",
    section: "第三方兼容 Provider",
    description: "候选端点列表，使用逗号或换行分隔。",
  },
  {
    key: "THEMIS_OPENAI_COMPAT_WIRE_API",
    section: "第三方兼容 Provider",
    description: "兼容通道协议类型。",
    note: "只有在完整配置 baseUrl / apiKey / model 时，这个字段才会参与生效；未填写时默认是 responses。",
  },
  {
    key: "THEMIS_OPENAI_COMPAT_SUPPORTS_WEBSOCKETS",
    section: "第三方兼容 Provider",
    description: "兼容 provider 是否支持 websockets。",
    note: "只有在完整配置 baseUrl / apiKey / model 时，这个字段才会参与生效；未填写时默认是 0。",
  },
  {
    key: "THEMIS_OPENAI_COMPAT_MODEL_CATALOG_JSON",
    section: "第三方兼容 Provider",
    description: "可选。显式指定 model catalog JSON 路径。",
  },
];

const SECTION_ORDER = [
  "服务监听",
  "版本更新",
  "Codex 认证",
  "飞书渠道",
  "第三方兼容 Provider",
] as const;

export function findProjectConfigDefinition(key: string): ProjectConfigDefinition | null {
  const normalized = key.trim();
  return PROJECT_CONFIG_DEFINITIONS.find((entry) => entry.key === normalized) ?? null;
}

export function listProjectConfigSections(): string[] {
  return [...SECTION_ORDER];
}

export function listProjectConfigDefinitionsBySection(section: string): ProjectConfigDefinition[] {
  return PROJECT_CONFIG_DEFINITIONS.filter((entry) => entry.section === section);
}

export function buildProjectEnvExampleContent(): string {
  const lines = [
    "# Themis local configuration",
    "# Generated as the recommended local template. Real shell env vars override this file.",
    "# After editing, restart `npm run dev:web` or `npm run start:web`.",
    "",
  ];

  for (const section of SECTION_ORDER) {
    lines.push(`# ${section}`);

    for (const item of listProjectConfigDefinitionsBySection(section)) {
      lines.push(`# ${item.description}`);

      if (item.note) {
        lines.push(`# ${item.note}`);
      }

      lines.push(`${item.key}=${renderTemplateValue(item.defaultValue ?? "")}`);
      lines.push("");
    }
  }

  return `${trimTrailingBlankLines(lines).join("\n")}\n`;
}

function renderTemplateValue(value: string): string {
  return value ? value : "\"\"";
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const next = [...lines];

  while (next.length > 0 && !next[next.length - 1]?.trim()) {
    next.pop();
  }

  return next;
}
