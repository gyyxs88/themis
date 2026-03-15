# GitHub Safe Publish Guide

## Goal

Connect this project to GitHub while avoiding accidental publication of:

- personal agent rules
- personal memory
- secrets
- local machine configuration

## Current Default Exclusions

The repository ignores these categories by default:

- `AGENTS.md`
- `memory/sessions/*.md` except `memory/sessions/README.md`
- `memory/local/`
- `docs/local/`
- `docs/private/`
- `.env*` except `.env.example`
- `.codex/`
- editor directories such as `.vscode/` and `.idea/`
- certificate and key files
- local override files such as `*.local.*`

## Suggested Working Rule

Shared project knowledge should go into:

- `docs/`
- `memory/project/`
- `memory/architecture/`
- `memory/decisions/`
- `memory/tasks/`

Personal or machine-specific content should stay in ignored locations.

## Before Pushing

Check these points:

1. `git status --short` does not include personal files.
2. No secrets or local credentials appear in staged files.
3. Session-specific notes are not being published by mistake.
4. Shared docs are written in a repository-safe form.

## Recommended Future Improvement

If needed, add a local pre-commit or pre-push check that blocks:

- `AGENTS.md`
- `memory/sessions/active.md`
- `.env*`
- key files
