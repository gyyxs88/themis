# Themis Product Design Input

## Document Purpose

This document translates official OpenAI Codex documentation into product and implementation input for Themis.

It is not an API reference.

It is a decision-support document for shaping the first real Themis product direction.

## Background

Themis is intended to be a secondary development layer built on top of the Codex SDK.

The project goal is not to recreate Codex from scratch. The goal is to provide a more personalized, easier-to-use shell for the owner and internal employees, while preserving context and workflow knowledge locally in the repository.

## Product Positioning

Based on the official Codex docs, Themis should be positioned as:

- a guided shell around Codex capabilities
- a team-oriented usage layer for internal workflows
- a safer and more opinionated operating surface than raw Codex
- a workspace that combines task execution with persistent Markdown memory

Themis should not initially be positioned as:

- a public general-purpose coding platform
- a brand new agent runtime unrelated to Codex behavior
- a memory-heavy enterprise platform with early infrastructure complexity

## What The Official Docs Suggest

The official OpenAI documentation indicates that Codex already provides several important building blocks:

- local and interactive usage through the CLI
- embedded programmable control through the SDK
- non-interactive execution for scripts and CI
- layered configuration through `config.toml`
- repository-local instructions through `AGENTS.md`
- reusable capability packaging through skills
- external tool and context extension through MCP
- explicit approval and sandbox controls

This means Themis does not need to invent these primitives first.

Instead, Themis should focus on making them easier, safer, and more consistent for internal users.

## Core Product Hypothesis

Themis will be valuable if it reduces the operational gap between "Codex is powerful" and "employees can use it confidently in daily work."

That gap likely comes from five recurring problems:

1. raw capability is harder to learn than task-oriented workflows
2. permission and sandbox choices are too technical for many users
3. project context is often missing or inconsistent
4. best practices are hard to keep consistent across users
5. useful outputs and decisions are not automatically captured into durable memory

## Primary User Types

### Owner

Needs:

- full control
- fast iteration
- advanced access to configuration and model choices
- visibility into ongoing work, decisions, and system behavior

### Employee

Needs:

- simple onboarding
- guided workflows instead of open-ended operation
- safer defaults
- limited need to understand low-level Codex configuration
- reliable handoff and continuity between sessions

## Product Principles

### 1. Guided Over Generic

Themis should expose common internal tasks as guided flows rather than requiring users to construct everything from first principles.

### 2. Safe By Default

Themis should favor `read-only` or `workspace-write` style operation by default, especially for employee-facing workflows.

### 3. Local Context First

Themis should make project-local context visible and durable through repository memory and repo instructions.

### 4. Opinionated But Extensible

Themis should provide a default internal operating model while preserving Codex extensibility through config, skills, and MCP.

### 5. Every Important Change Leaves A Trace

Tasks, decisions, and session handoffs should be reflected in the Markdown memory system.

## Product Surface Recommendation

### Revised Direction

Do not treat CLI as the main user-facing product surface for employees.

Themis should instead adopt a two-layer employee-facing usability strategy:

1. a LAN-accessible web frontend for desktop use
2. a Feishu plugin or bot-connected interface for mobile and chat-driven use

CLI should remain in the system, but as an operator and development interface rather than the primary employee experience.

### Why This Direction Fits Better

- the current employee usability problem is caused in part by CLI friction
- a web frontend is easier to onboard, easier to discover, and easier to standardize
- a Feishu-connected interface reaches employees in an existing daily-work channel
- mobile access matters for convenience and response speed
- a visual layer is better for exposing workflow presets, safety state, task history, and memory updates

### Product Surface Roles

#### Web Frontend

Primary use:

- desktop-based internal operations on the local network

Best for:

- guided workflow selection
- visible task state
- richer progress display
- memory browsing and editing
- admin and owner control panels

#### Feishu Plugin Or Bot Interface

Primary use:

- lightweight mobile-friendly access through existing work chat

Best for:

- quick requests
- task follow-up
- approvals or confirmations
- progress and result notifications
- employee usage without requiring direct access to a development environment

#### CLI

Primary use:

- operator tooling
- local development
- debugging
- automation and maintenance tasks

CLI is still useful, but it should support the product rather than define the product.

## Recommended Themis Capability Layers

### Layer 1: Interaction Channels

The employee-facing entrypoints that start and manage a Codex-powered work session.

Expected responsibilities:

- collect user intent in a guided way
- choose workflow mode
- apply role-aware defaults
- show progress and current context
- make memory-related actions visible

Primary channels:

- LAN web frontend
- Feishu plugin or bot-connected interface

Supporting channel:

- operator CLI

### Layer 2: Communication Layer

Themis should introduce a communication layer between external channels and the core task runtime.

This layer exists so that Feishu is not directly coupled to the Themis core.

Expected responsibilities:

- normalize incoming channel requests into a shared task request format
- map Themis progress and results back into channel-specific messages
- isolate channel-specific auth, event, and message formats
- make future channel additions cheaper

Examples of channels that can plug into this layer:

- Feishu
- future chat tools
- future mobile-facing integrations
- notification systems

### Layer 3: Workflow Presets

Themis should provide prebuilt task modes instead of a single undifferentiated prompt box.

Examples:

- code implementation
- code review
- bug investigation
- documentation update
- repo onboarding
- structured research

Each preset should control:

- initial instructions
- default model or reasoning level
- approval and sandbox expectations
- expected output format
- whether memory updates are required

### Layer 4: Memory Integration

Themis should integrate directly with the Markdown memory system created in this repository.

Expected responsibilities:

- create or update session notes
- move tasks across backlog, in-progress, and done
- record durable decisions when needed
- link output back to source docs or implementation context

### Layer 5: Extension Layer

Themis should preserve Codex-native extensibility:

- `AGENTS.md` for repo behavior
- skills for repeatable expertise
- MCP for external systems and knowledge
- config profiles for different user roles or workflows

## MVP Scope Recommendation

The first practical MVP should likely include:

1. a LAN web frontend for employees and the owner
2. a Feishu-connected entry for quick mobile usage
3. workflow presets for 3 to 5 common internal tasks
4. role-aware default permission modes
5. automatic session note creation in `memory/sessions/`
6. lightweight task status updates in `memory/tasks/`
7. shared project instructions loaded from repo context

The MVP should probably avoid:

- trying to expose every Codex capability directly in the UI
- database-backed memory before real usage pressure exists
- too many workflow presets
- unrestricted employee access to dangerous modes
- deep multi-agent orchestration on day one
- designing the web and Feishu surfaces as two unrelated products

## Functional Requirements

### FR-1 Session Start

The system should let a user start a task with a clear goal and selected workflow type from a web interface or Feishu-connected interface.

### FR-2 Guided Mode Selection

The system should offer workflow presets instead of forcing raw prompt construction every time.

### FR-3 Channel Abstraction

External channels should communicate with the Themis core through a shared communication layer rather than through one-off direct integrations.

### FR-4 Context Injection

The system should consistently inject repo instructions, memory context, and workflow rules into each task.

### FR-5 Safe Defaults

The system should apply default approval and sandbox settings based on user role and workflow type.

### FR-6 Memory Persistence

The system should update Markdown memory files when meaningful work starts, changes, or finishes.

### FR-7 Structured Output

For automatable workflows, the system should support structured final outputs suitable for scripts or post-processing.

### FR-8 Multi-Channel Delivery

The system should support at least two user-facing channels that share the same workflow logic:

- LAN web frontend
- Feishu plugin or bot-connected interface

### FR-9 Extensibility

The system should support future integration with skills, MCP servers, and profile-based configuration.

## Non-Functional Requirements

### NFR-1 Low Learning Cost

Employees should be able to complete common workflows without understanding raw Codex internals.

### NFR-2 Auditability

Work decisions, session state, and permission posture should be understandable from files and logs.

### NFR-3 Repo-Native Operation

The system should work well in a local repository and stay compatible with Git-based collaboration.

### NFR-4 Incremental Adoption

Themis should not require a full platform rollout before it becomes useful.

### NFR-5 Cross-Channel Consistency

A task started from web and a task started from Feishu should follow the same core workflow rules, memory behavior, and safety defaults.

## Recommended Permission Model

Based on official Codex security guidance, Themis should define explicit operating modes.

### Employee Safe Mode

- sandbox preference: `read-only` or `workspace-write`
- approval policy: `untrusted` or similarly conservative behavior
- suitable for documentation, analysis, planning, and guided code tasks

### Owner Standard Mode

- sandbox preference: `workspace-write`
- approval policy: more flexible, but still visible
- suitable for normal implementation and project maintenance

### Automation Mode

- auth path: API key
- predictable structured outputs
- non-interactive execution
- tightly controlled environment assumptions

### Elevated Mode

- explicit only
- auditable
- not the default for employee workflows
- reserved for cases where broader system access is justified

## Recommended Configuration Strategy

The official docs suggest Codex already supports layered configuration, so Themis should align with that instead of replacing it.

Recommended configuration model:

- system or organization defaults when needed
- user-level defaults in `~/.codex/config.toml`
- repo-level defaults in `.codex/config.toml`
- workflow-level overrides through the Themis shell

Themis-specific value should come from:

- preset profiles
- safer defaults
- role-based configuration bundles
- memory-aware behavior

## Recommended Model Strategy

This part should remain configurable because official model guidance can change.

Based on the current official docs as of `2026-03-15`:

- `gpt-5.4` is the general starting point for complex reasoning and coding
- `gpt-5.3-codex` is a strong candidate for Codex-specific agentic coding workflows

Recommended product approach:

- keep the default model configurable
- support at least one high-capability default and one lower-cost fallback
- avoid hard-coding deprecated model choices such as `codex-mini-latest`

This recommendation is an inference from current official documentation and should be revalidated periodically.

## Workflow Preset Candidates

### 1. Implement Task

Purpose:

- turn a scoped request into code and docs changes

Likely defaults:

- stronger coding model
- workspace-write
- memory update on completion

### 2. Review Task

Purpose:

- inspect code for bugs, risk, regressions, and test gaps

Likely defaults:

- read-only or restricted write
- structured findings-first output

### 3. Investigate Bug

Purpose:

- diagnose failures, narrow root causes, and propose fixes

Likely defaults:

- medium to high reasoning
- workspace awareness
- decision note if root cause changes system behavior

### 4. Update Documentation

Purpose:

- maintain README, docs, memory, and onboarding artifacts

Likely defaults:

- safe permission mode
- mandatory memory sync

### 5. Research And Plan

Purpose:

- collect context, compare options, and produce an implementation plan

Likely defaults:

- read-only
- strong source attribution
- no code changes unless explicitly promoted

## Memory System Integration Requirements

Themis should treat Markdown memory as part of the product, not as an afterthought.

Minimum expected behaviors:

- open or refresh `memory/sessions/active.md` at task start
- append meaningful session progress
- update task status when work transitions state
- encourage durable decisions to be written into `memory/decisions/`
- keep project-level docs aligned when scope or architecture changes

## Suggested Initial Architecture

The current best-fit architecture is:

- a Node.js and TypeScript backend around the Codex SDK
- a LAN web frontend for desktop usage
- a communication layer for external channels
- a Feishu plugin or bot attached through that communication layer for mobile and chat usage
- local Markdown files as the memory store
- repository instructions through `AGENTS.md`
- optional skills and MCP integrations added incrementally

This architecture has the best alignment with the current Themis product goals because it improves usability without discarding Codex-native extensibility.

## Key Open Product Decisions

These questions now deserve explicit owner decisions before implementation goes too far:

1. What is the exact MVP scope split between web and Feishu?
2. Which employee workflows matter most in the first 30 days?
3. What permission level should employees get by default?
4. Should memory updates be fully automatic, partially assisted, or user-confirmed?
5. Which model should be the first default for implementation workflows?
6. Should Feishu be limited to lightweight task types in MVP?
7. What is the minimal shared request and event protocol for the communication layer?

## Immediate Build Recommendations

The next implementation milestone should likely produce:

1. a shared backend session orchestration layer
2. a communication layer with a normalized request and event model
3. one web workflow entry flow
4. one Feishu workflow entry flow through the communication layer
5. one workflow preset for implementation
6. one workflow preset for documentation
7. a memory sync helper for `sessions` and `tasks`
8. a first `.codex/config.toml` strategy for internal use

## Source Map

This document is derived from:

- [Codex Overview](/home/gyyxs88/Projects/Themis/docs/openai/codex/getting-started/overview.md)
- [Codex CLI](/home/gyyxs88/Projects/Themis/docs/openai/codex/getting-started/cli.md)
- [Codex SDK And Non-Interactive Mode](/home/gyyxs88/Projects/Themis/docs/openai/codex/automation/sdk-and-noninteractive.md)
- [Codex Configuration](/home/gyyxs88/Projects/Themis/docs/openai/codex/configuration/configuration.md)
- [Instructions, AGENTS, Skills, And MCP](/home/gyyxs88/Projects/Themis/docs/openai/codex/configuration/instructions-and-extensions.md)
- [Auth And Security](/home/gyyxs88/Projects/Themis/docs/openai/codex/security/auth-and-security.md)
- [Best Practices And Prompting](/home/gyyxs88/Projects/Themis/docs/openai/codex/learn/best-practices-and-prompting.md)
- [Codex Models](/home/gyyxs88/Projects/Themis/docs/openai/codex/models/codex-models.md)
