#!/usr/bin/env bash
set -euo pipefail

TARGET_ROOT="${1:-}"

if [[ -z "${TARGET_ROOT}" ]]; then
  echo "用法：bash scripts/bootstrap-split-repos.sh <target-root>" >&2
  exit 1
fi

mkdir -p "${TARGET_ROOT}"

create_repo() {
  local repo_name="$1"
  local entrypoint="$2"
  local repo_dir="${TARGET_ROOT}/${repo_name}"

  ensure_empty_repo_dir "${repo_dir}"
  mkdir -p "${repo_dir}/$(dirname "${entrypoint}")" "${repo_dir}/.github/workflows"
  git init -q "${repo_dir}"

  write_gitignore "${repo_dir}"
  write_tsconfig "${repo_dir}"
  write_readme "${repo_name}" "${repo_dir}" "${entrypoint}"
  write_package_json "${repo_name}" "${repo_dir}" "${entrypoint}"
  write_entrypoint "${repo_name}" "${repo_dir}" "${entrypoint}"
  write_ci_workflow "${repo_dir}"
}

ensure_empty_repo_dir() {
  local repo_dir="$1"

  if [[ ! -d "${repo_dir}" ]]; then
    mkdir -p "${repo_dir}"
    return
  fi

  if find "${repo_dir}" -mindepth 1 -print -quit | grep -q .; then
    echo "拒绝覆盖非空目录：${repo_dir}" >&2
    exit 1
  fi
}

write_gitignore() {
  local repo_dir="$1"

  cat > "${repo_dir}/.gitignore" <<'EOF'
node_modules/
dist/
.env.local
temp/
EOF
}

write_tsconfig() {
  local repo_dir="$1"

  cat > "${repo_dir}/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
EOF
}

write_readme() {
  local repo_name="$1"
  local repo_dir="$2"
  local entrypoint="$3"
  local scope_line=""
  local next_step=""

  case "${repo_name}" in
    themis-platform)
      scope_line="负责平台控制面、平台页面、节点/租约/调度/值班治理。"
      next_step="下一步应优先迁入 src/server/http-platform.ts、apps/platform/ 与平台 CLI。"
      ;;
    themis-main)
      scope_line="负责主 Themis 自己的 Web / 飞书入口、会话、历史、身份与派工入口。"
      next_step="下一步应优先收口 http-agents.ts 的 gateway 语义，并迁出平台兼容页面。"
      ;;
    themis-worker-node)
      scope_line="负责 Worker Node 本机预检、常驻执行、工作区与 credential 能力声明。"
      next_step="下一步应优先迁入 worker-node daemon、doctor worker-node 与本机执行链。"
      ;;
    themis-contracts)
      scope_line="负责平台 API、Worker 协议、平台 access/error code 等显式契约产物。"
      next_step="下一步应优先迁入 managed-agent-platform-* 这组 contracts 并补 package exports。"
      ;;
    *)
      echo "未知 repo：${repo_name}" >&2
      exit 1
      ;;
  esac

  cat > "${repo_dir}/README.md" <<EOF
# ${repo_name}

这是由 \`scripts/bootstrap-split-repos.sh\` 初始化出来的拆仓骨架。

${scope_line}

- 当前入口：\`${entrypoint}\`
- 当前状态：仅提供最小 TypeScript / CI / README 壳，不包含业务迁移代码
- 迁移依据：请对照 \`themis\` 主仓里的 \`docs/repository/themis-three-layer-split-migration-checklist.md\`

${next_step}
EOF
}

write_package_json() {
  local repo_name="$1"
  local repo_dir="$2"
  local entrypoint="$3"
  local extra_scripts=""

  case "${repo_name}" in
    themis-platform)
      extra_scripts=$'    "dev:platform": "tsx watch --clear-screen=false src/server/platform-main.ts",\n    "start:platform": "node dist/server/platform-main.js"'
      ;;
    themis-main)
      extra_scripts=$'    "dev:web": "tsx watch --clear-screen=false src/server/main.ts",\n    "start:web": "node dist/server/main.js"'
      ;;
    themis-worker-node)
      extra_scripts=$'    "themis:worker-node": "tsx src/cli/worker-node-main.ts"'
      ;;
    themis-contracts)
      extra_scripts=""
      ;;
    *)
      echo "未知 repo：${repo_name}" >&2
      exit 1
      ;;
  esac

  cat > "${repo_dir}/package.json" <<EOF
{
  "name": "${repo_name}",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc"${extra_scripts:+,
${extra_scripts}}
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3"
  }
}
EOF
}

write_entrypoint() {
  local repo_name="$1"
  local repo_dir="$2"
  local entrypoint="$3"
  local message=""

  case "${repo_name}" in
    themis-platform)
      message="TODO: 在 themis-platform 仓接入平台控制面 HTTP server 与平台独立前端。"
      ;;
    themis-main)
      message="TODO: 在 themis-main 仓接入主 Themis 自己的 Web / 飞书入口与 gateway 收缩后主链。"
      ;;
    themis-worker-node)
      message="TODO: 在 themis-worker-node 仓接入 worker daemon、本机预检与本机执行链。"
      ;;
    themis-contracts)
      message="TODO: 在 themis-contracts 仓导出 managed-agent-platform-* 显式契约。"
      ;;
    *)
      echo "未知 repo：${repo_name}" >&2
      exit 1
      ;;
  esac

  cat > "${repo_dir}/${entrypoint}" <<EOF
export function bootstrapMessage(): string {
  return "${message}";
}

console.log(bootstrapMessage());
EOF
}

write_ci_workflow() {
  local repo_dir="$1"

  cat > "${repo_dir}/.github/workflows/ci.yml" <<'EOF'
name: ci

on:
  push:
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: npm run typecheck
      - run: npm run build
EOF
}

create_repo "themis-platform" "src/server/platform-main.ts"
create_repo "themis-main" "src/server/main.ts"
create_repo "themis-worker-node" "src/cli/worker-node-main.ts"
create_repo "themis-contracts" "src/index.ts"

echo "已初始化拆仓骨架："
echo "  - ${TARGET_ROOT}/themis-platform"
echo "  - ${TARGET_ROOT}/themis-main"
echo "  - ${TARGET_ROOT}/themis-worker-node"
echo "  - ${TARGET_ROOT}/themis-contracts"
