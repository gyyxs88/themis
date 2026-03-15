# Themis

Themis is a secondary development project built on top of the Codex SDK.

Its goal is to provide a personalized and easier-to-use shell for the owner and employees, while keeping project knowledge, decisions, tasks, and collaboration records persistently stored in the repository.

## Current Focus

- Build a usable shell experience on top of the Codex SDK
- Lower the learning and usage cost for internal team members
- Preserve project memory in Markdown so context is not lost across sessions

## Repository Structure

- `src`: core application code
- `apps`: runnable apps, demos, and interfaces
- `tests`: automated tests
- `scripts`: local helper scripts
- `docs`: design notes and documentation
- `infra`: deployment and environment files
- `memory`: persistent project memory stored as Markdown

## Markdown Memory System

The project now includes a file-based persistent memory system under [`memory/`](/home/gyyxs88/Projects/Themis/memory).

This system is designed to support ongoing work by keeping important information close to the codebase:

- project goals and scope
- active and completed work
- architectural notes
- decision records
- session handoff notes
- reusable templates

## Memory Entry Points

- [`memory/index.md`](/home/gyyxs88/Projects/Themis/memory/index.md): memory navigation hub
- [`memory/project/overview.md`](/home/gyyxs88/Projects/Themis/memory/project/overview.md): project intent, scope, and current phase
- [`memory/tasks/in-progress.md`](/home/gyyxs88/Projects/Themis/memory/tasks/in-progress.md): work currently being executed
- [`memory/tasks/backlog.md`](/home/gyyxs88/Projects/Themis/memory/tasks/backlog.md): upcoming work candidates
- [`memory/decisions/`](/home/gyyxs88/Projects/Themis/memory/decisions): durable decision records
- [`memory/sessions/active.md`](/home/gyyxs88/Projects/Themis/memory/sessions/active.md): current working context
- [`memory/operations/working-agreement.md`](/home/gyyxs88/Projects/Themis/memory/operations/working-agreement.md): rules for keeping memory up to date

## Recommended Update Flow

When meaningful work happens, update the memory files together with the code:

1. Update [`memory/sessions/active.md`](/home/gyyxs88/Projects/Themis/memory/sessions/active.md) during active work.
2. Move task status across backlog, in-progress, and done files.
3. Record important decisions in [`memory/decisions/`](/home/gyyxs88/Projects/Themis/memory/decisions).
4. Refresh project-level docs when goals, scope, or architecture change.

## Collaboration Notes

This repository is intended to be usable by both the owner and internal employees.

The memory system is intentionally plain Markdown so it can be:

- edited in any editor
- reviewed in Git
- searched with simple tools
- extended without introducing a database or service dependency
