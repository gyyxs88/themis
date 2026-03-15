# Themis MVP Technical Architecture

## Purpose

This document defines the recommended MVP technical architecture for Themis.

It translates the product design input into a buildable system shape.

## Architecture Goal

Build a shared backend on top of the Codex SDK that powers:

- a LAN web frontend for desktop users
- a communication layer for external channels
- a Feishu plugin or bot-connected interface through that communication layer for chat and mobile users
- an internal operator CLI for development, debugging, and maintenance

The system should:

- guide internal users through common workflows
- apply safer defaults than raw Codex usage
- store durable project memory in Markdown
- remain compatible with Codex-native configuration, instructions, skills, and MCP

## MVP System Boundary

### Codex Native Responsibilities

These capabilities should remain primarily handled by Codex itself:

- model execution
- tool calling
- multi-turn task thread handling
- low-level provider behavior
- sandbox and approval primitives
- MCP connectivity

### Themis Responsibilities

These are the product-added responsibilities:

- multi-channel guided workflow entry
- communication-layer-based channel abstraction
- role-aware defaults
- task-oriented interaction surface
- memory synchronization
- project-context packaging
- consistent output and handoff structure

## Recommended Runtime Stack

### Language And Runtime

- Node.js 18+
- TypeScript
- `@openai/codex-sdk`

### Product Surfaces

- web frontend
- communication layer
- Feishu channel adapter
- operator CLI

Reasoning:

- official SDK support exists here first
- best fit for backend services, internal tooling, and structured local orchestration
- easier future extension into TUI or small internal service layers

## High-Level Architecture

### 1. Web Frontend

The main employee-facing desktop interface exposed on the local network.

Responsibilities:

- workflow selection
- task form input
- progress display
- task and memory browsing
- role-aware UI controls

### 2. Communication Layer

This layer sits between external channels and the Themis core.

Responsibilities:

- receive normalized channel requests
- validate channel payloads
- convert channel events into shared task requests
- map internal progress and results into channel-safe messages
- isolate channel-specific transport behavior from core runtime

This layer is the key extensibility seam for future channels.

### 3. Feishu Channel Adapter

The main chat and mobile adapter in the MVP.

Responsibilities:

- receive user requests from Feishu
- convert Feishu events into communication-layer requests
- handle lightweight confirmations and follow-ups
- push progress and result notifications through Feishu formats

Feishu should attach to the communication layer instead of directly to the Themis core.

### 4. Session Orchestrator

This is the main application coordinator.

Responsibilities:

- create or resume a Codex thread
- construct the final task prompt package
- apply workflow-specific options
- subscribe to progress events
- emit normalized task events and results for downstream routing
- coordinate memory updates through the memory service

This is the most important Themis-owned runtime module.

### 5. Context Builder

This module builds the context package sent to Codex.

Input sources:

- explicit user goal
- workflow preset definition
- project `AGENTS.md`
- memory files
- local task metadata
- optional config profile

Output:

- a structured task brief
- relevant repo context
- memory instructions
- output requirements

### 6. Workflow Preset Registry

This module stores reusable workflow definitions.

Each preset should define:

- workflow name
- description
- default model hint
- default reasoning level
- approval policy
- sandbox mode
- required memory behavior
- output template
- optional completion checklist

### 7. Memory Service

This module reads and writes the Markdown memory system.

Responsibilities:

- create session entries
- update `memory/sessions/active.md`
- move tasks between backlog, in-progress, and done
- create decision record stubs when requested
- maintain consistent timestamps and sections

The memory service should not attempt to be a database.

It should stay simple, file-oriented, and deterministic.

### 8. Config Resolver

This module combines:

- Themis defaults
- repo-level settings
- user-level settings
- workflow-specific overrides
- one-off CLI flags

It should align with Codex's own config layering rather than fighting it.

### 9. Channel Adapters

This module implements the plug-in points used by the communication layer.

Examples:

- Feishu cards or messages
- future chat adapters
- notification adapters
- CLI operator output where useful

Adapters should consume normalized events and results rather than reading core runtime internals directly.

### 10. Operator CLI

This is not the main employee surface.

It exists for:

- local development
- debugging
- admin operations
- maintenance workflows

## Proposed Module Layout

Suggested early source layout:

- `apps/web/`: LAN web frontend
- `apps/feishu/`: Feishu plugin or bot integration
- `src/server/`: application server and API endpoints
- `src/communication/`: shared channel request and event layer
- `src/core/`: session orchestration and runtime logic
- `src/workflows/`: preset definitions
- `src/context/`: context assembly and repo-memory loading
- `src/memory/`: Markdown memory read/write helpers
- `src/config/`: layered config resolution
- `src/channels/`: channel-specific adapters such as Feishu
- `src/cli/`: operator CLI entrypoints
- `src/types/`: shared types

Core protocol definitions should live under `src/communication/` or `src/types/` and be shared across all channels.

## Request Lifecycle

### Step 1 User Starts A Workflow

The user provides:

- workflow type
- task goal
- optional role or profile
- optional safety override
- source channel: web or Feishu

### Step 2 Communication Layer Normalizes The Request

The system:

- identifies the source channel
- converts the incoming payload into a shared request format
- validates channel metadata
- forwards a normalized request to the core runtime

### Step 3 Themis Resolves Context

The system loads:

- workflow preset
- project instructions
- relevant memory documents
- local configuration

### Step 4 Memory Start Hook Runs

The system:

- updates `memory/sessions/active.md`
- optionally adds or promotes a task into `memory/tasks/in-progress.md`

### Step 5 Codex Thread Runs

The session orchestrator:

- starts a Codex thread
- sends the assembled prompt package
- emits normalized progress events

### Step 6 Result Processing

The system:

- shows final outcome
- captures structured metadata if available
- updates memory files based on workflow rules

### Step 7 Communication Layer Emits Channel Responses

The system:

- maps internal events into channel-appropriate output
- applies Feishu-specific formatting where needed
- preserves a common result model underneath

### Step 8 Completion Sync

The system:

- marks task progress
- recommends decision notes if needed
- leaves a clear next-step trail

## Context Packaging Strategy

Themis should not dump the entire repository into every request.

Instead it should build a small, explicit context package:

- user goal
- workflow instructions
- relevant project summary
- relevant active session summary
- relevant task state
- repo-specific do and do-not instructions

This follows the official Codex guidance to keep context scoped and task-oriented.

## Memory Architecture

### Memory As Product Infrastructure

For Themis, Markdown memory is not just documentation.

It is part of the runtime contract.

That means the MVP should define specific file responsibilities:

- `memory/project/`: durable project facts
- `memory/tasks/`: work state
- `memory/sessions/`: current run context and handoff
- `memory/decisions/`: durable decision records

### Memory Write Rules

Themis should perform only small, predictable writes.

Examples:

- add a bullet under latest changes
- replace current active work section
- append a new task bullet if absent
- create a decision template file when explicitly asked

Avoid in MVP:

- heavy summarization over many files
- auto-rewriting large documents
- trying to infer too much from ambiguous user intent

## Configuration Model

### Config Layers

Recommended precedence:

1. Themis CLI flags
2. Themis workflow preset
3. channel-level defaults where applicable
4. repo `.codex/config.toml`
5. user `~/.codex/config.toml`
6. built-in Themis defaults

### Themis-Specific Config Concepts

Themis may add a lightweight config namespace later, but MVP should minimize custom config.

Suggested initial concepts:

- default user role
- default workflow preset
- memory auto-sync behavior
- preferred model aliases

## Security Model

### Default Safety Posture

Themis should make the safe path the normal path.

Recommended defaults:

- employee workflows default to read-only or workspace-write
- dangerous modes require explicit opt-in
- automation mode is separate from interactive mode

### Auditability

Every run should expose:

- chosen workflow
- selected role or profile
- approval mode
- sandbox mode
- whether memory updates occurred

## Workflow Preset Model

Each preset should be represented as structured configuration.

Example shape:

```ts
type WorkflowPreset = {
  id: string;
  label: string;
  description: string;
  model?: string;
  reasoning?: "low" | "medium" | "high" | "xhigh";
  approvalPolicy: string;
  sandboxMode: string;
  requiresMemorySync: boolean;
  outputStyle: "freeform" | "review" | "plan" | "structured";
};
```

This keeps Themis opinionated without hard-coding behavior into many places.

## MVP Workflow Set

Recommended first set:

- `implement`
- `review`
- `docs`
- `investigate`

This is enough to prove the shell value without creating too much configuration surface.

## Suggested Channel Execution Strategy

For MVP, prefer a single active workflow execution model per task request, regardless of whether it starts from web or Feishu.

Avoid early complexity such as:

- deeply branching chat workflows
- background orchestration across many concurrent long-running tasks
- complex multi-user session ownership models

The first version should optimize for clarity over throughput.

## Error Handling Strategy

Common failure classes:

- invalid workflow input
- invalid channel payload
- missing config
- Codex auth failure
- memory file missing or malformed
- task interrupted before completion

MVP behavior should be:

- fail clearly
- preserve partial context if useful
- avoid corrupting memory files
- tell the user exactly what was and was not persisted

## Testing Strategy

### Unit Tests

Target:

- config resolution
- workflow selection
- context building
- memory file patch logic

### Integration Tests

Target:

- web request to session startup
- Feishu request to session startup
- communication-layer request normalization
- communication-layer event routing
- memory synchronization paths
- structured workflow output handling

### Manual Acceptance Tests

Target:

- employee-safe workflow run
- owner implementation run
- docs update run with memory sync
- interrupted run recovery
- mobile-triggered Feishu task flow

## Incremental Delivery Plan

### Milestone 1

- shared backend skeleton
- communication layer contract
- workflow registry
- memory service with session/task updates
- minimal web entry flow

### Milestone 2

- Codex SDK integration
- progress rendering
- role-aware safety defaults
- minimal Feishu adapter through the communication layer

### Milestone 3

- better channel-specific output formatting
- structured workflow modes
- config profile refinement

## Risks

### Risk 1

Too much Themis logic may duplicate Codex behavior.

Mitigation:

- keep Themis focused on workflow shaping, context, and memory

### Risk 2

Memory auto-updates may become noisy or inaccurate.

Mitigation:

- use small targeted writes and predictable templates

### Risk 3

Too many presets too early may confuse users.

Mitigation:

- start with four strong presets and expand from real usage

## Architecture Decision Summary

The best MVP architecture is:

- web-first and Feishu-enabled for employee usage
- communication-layer-based for future channel expansion
- CLI-supported for operators and developers
- TypeScript and Node.js
- Codex SDK-backed
- workflow-preset-driven
- Markdown-memory-integrated
- safe-by-default
