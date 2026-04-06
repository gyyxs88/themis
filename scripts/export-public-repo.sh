#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
用法：
  bash scripts/export-public-repo.sh [--dry-run] <公开仓目录>

说明：
  - 当前仓库视为内部开发仓 A。
  - <公开仓目录> 视为公开发布仓 B。
  - 导出采用白名单规则，规则文件位于 scripts/public-repo-rsync.filter。
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILTER_FILE="$ROOT_DIR/scripts/public-repo-rsync.filter"
DRY_RUN=0
TARGET_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$TARGET_DIR" ]]; then
        echo "错误：只允许提供一个公开仓目录。" >&2
        usage >&2
        exit 1
      fi
      TARGET_DIR="$1"
      shift
      ;;
  esac
done

if [[ -z "$TARGET_DIR" ]]; then
  echo "错误：缺少公开仓目录。" >&2
  usage >&2
  exit 1
fi

if [[ ! -f "$FILTER_FILE" ]]; then
  echo "错误：白名单规则文件不存在：$FILTER_FILE" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "错误：当前环境缺少 rsync，无法导出公开仓镜像。" >&2
  exit 1
fi

mkdir -p "$TARGET_DIR"
TARGET_DIR="$(cd "$TARGET_DIR" && pwd)"

if [[ "$TARGET_DIR" == "$ROOT_DIR" ]]; then
  echo "错误：公开仓目录不能和开发仓相同。" >&2
  exit 1
fi

if [[ "$TARGET_DIR" == "$ROOT_DIR/"* ]]; then
  echo "错误：公开仓目录不能放在开发仓内部，避免相互污染。" >&2
  exit 1
fi

RSYNC_ARGS=(
  -a
  -m
  --delete
  --delete-excluded
  --prune-empty-dirs
  --filter='P /.git/'
  --filter=". $FILTER_FILE"
)

if [[ "$DRY_RUN" -eq 1 ]]; then
  RSYNC_ARGS+=(--dry-run --itemize-changes)
fi

echo "开发仓 A：$ROOT_DIR"
echo "公开仓 B：$TARGET_DIR"
echo "白名单：$FILTER_FILE"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "模式：dry-run"
else
  echo "模式：apply"
fi

rsync "${RSYNC_ARGS[@]}" "$ROOT_DIR/" "$TARGET_DIR/"

echo "导出完成。"
