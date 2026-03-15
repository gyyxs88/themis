# Themis Operator CLI Design

## Purpose

This document defines the recommended operator CLI surface for the first Themis MVP.

This is not the main employee-facing product surface.

Its purpose is to support:

- local development
- debugging
- maintenance
- admin operations
- automation support

## Design Goals

- operationally clear
- task-oriented
- safe by default
- explicit about permissions
- compatible with future automation
- connected to Markdown memory

## Command Design Philosophy

Raw Codex is powerful but open-ended.

For employees, Themis should primarily expose visual surfaces such as:

- LAN web frontend
- Feishu plugin or bot-connected interface

The operator CLI exists so technical users can inspect and control the system more directly.

That means commands should map to common intentions, not raw technical toggles.

Operators should usually start with:

- what they want to do
- what role they are acting as
- whether the run should update memory

They should not need to think first about:

- low-level provider settings
- prompt composition
- manual memory file editing
- Codex-specific config precedence

## Primary Entry Command

Recommended root command:

```bash
themis
```

Recommended first subcommands:

- `themis start`
- `themis review`
- `themis docs`
- `themis task`
- `themis memory`
- `themis config`

## Core Command Flows

### 1. Start A Guided Workflow

Recommended form:

```bash
themis start <workflow> "<goal>"
```

Examples:

```bash
themis start implement "Add a login retry mechanism"
themis start investigate "Why are employee sessions timing out?"
themis start docs "Update onboarding instructions for new staff"
```

This should be the main entrypoint for developers and operators.

### 2. Review-Focused Shortcut

Recommended form:

```bash
themis review "<goal>"
```

Example:

```bash
themis review "Review the recent auth changes for security risks"
```

This is a shortcut for a common high-value workflow with findings-first output.

### 3. Documentation-Focused Shortcut

Recommended form:

```bash
themis docs "<goal>"
```

Example:

```bash
themis docs "Refresh the employee quick-start guide"
```

This is a safe default workflow optimized for documentation and memory sync.

## Supporting Command Groups

### `themis task`

Purpose:

- inspect or update task state in the Markdown memory system

Suggested subcommands:

- `themis task list`
- `themis task add "<title>"`
- `themis task start "<title>"`
- `themis task done "<title>"`

This gives a lightweight operational bridge between workflow runs and task memory.

### `themis memory`

Purpose:

- inspect or maintain memory files directly

Suggested subcommands:

- `themis memory status`
- `themis memory sync`
- `themis memory session`
- `themis memory decision "<title>"`

This keeps memory visible as part of system operations.

### `themis config`

Purpose:

- display effective behavior without forcing users to read multiple config files manually

Suggested subcommands:

- `themis config show`
- `themis config profile list`
- `themis config doctor`

This is especially useful because Codex configuration is layered and can otherwise feel opaque.

## Global Flags

Recommended first global flags:

- `--role <owner|employee>`
- `--profile <name>`
- `--model <id>`
- `--reasoning <low|medium|high|xhigh>`
- `--memory <auto|off|confirm>`
- `--sandbox <read-only|workspace-write|danger-full-access>`
- `--approval <never|untrusted|on-request>`
- `--json`

## Flag Design Principles

### Principle 1

Flags may override defaults, but should not be required for normal use.

### Principle 2

Dangerous flags should feel explicit and uncommon.

### Principle 3

Memory behavior should be user-visible, not hidden.

### Principle 4

Structured output support should exist early for automation and future integration.

## Recommended Workflow Presets

### `implement`

User intent:

- make code or project changes

Default posture:

- role-aware write access
- memory sync enabled
- completion summary required

### `review`

User intent:

- inspect code quality, risk, or regressions

Default posture:

- read-focused
- findings-first output
- minimal memory writes unless requested

### `investigate`

User intent:

- understand an issue and narrow likely causes

Default posture:

- medium or high reasoning
- read-only or limited write depending on profile
- produce diagnosis plus next actions

### `docs`

User intent:

- update documentation, memory, or onboarding materials

Default posture:

- safer write permissions
- strong memory synchronization
- clear changed-files summary

## Interaction Model

### Default Experience

An operator run should feel like this:

1. user enters a goal
2. Themis resolves workflow and safety settings
3. Themis shows a short "run header"
4. Codex-powered work begins
5. progress updates appear
6. final summary is shown
7. memory updates are confirmed

### Recommended Run Header

Before work begins, Themis should print something like:

```text
Workflow: implement
Role: employee
Sandbox: workspace-write
Approval: untrusted
Memory sync: auto
Goal: Add an onboarding helper command
```

This makes the run understandable before any work happens.

## Output Design

### Human Output

For interactive use, output should emphasize:

- what Themis is doing
- current workflow
- progress checkpoints
- final result
- memory changes made

### Structured Output

For automation or integration, `--json` should expose:

- workflow metadata
- effective runtime settings
- progress events
- final outcome
- memory update results

## Memory-Linked UX Rules

Themis should make memory updates visible, not magical.

Examples:

- "Updated active session notes"
- "Moved task to done"
- "Decision note suggested but not created"

This is important because durable context is one of the main product values.

## Recommended Role Behavior

### Owner

Characteristics:

- more control
- more override freedom
- better suited to implementation and architectural workflows

### Employee

Characteristics:

- guided workflows first
- safer permission defaults
- less exposure to dangerous flags
- stronger memory and onboarding support

## Suggested Help Design

The `--help` output should emphasize examples over exhaustive theory.

Users should quickly see:

- common commands
- common workflows
- safe usage patterns
- where memory is written

## Suggested Future Commands

These are useful later, but not required in MVP:

- `themis resume`
- `themis plan`
- `themis onboard`
- `themis mcp`
- `themis skill`

## Anti-Patterns To Avoid

- too many top-level commands
- exposing every Codex toggle as a first-class concept
- hiding safety mode from the user
- silently rewriting many memory files
- forcing employees to learn Codex internals before getting value

## Command Design Summary

The best MVP operator CLI design is:

- one strong root command
- workflow-first entry for technical users
- visible safety header
- role-aware defaults
- explicit memory integration
- optional structured output for future automation

Employee usability should be delivered primarily through the web and Feishu channels, not through this CLI.
