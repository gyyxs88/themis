# Themis Communication Protocol

## Purpose

This document defines the shared protocol between external channels and the Themis core runtime.

Its goal is to preserve modularity by ensuring that:

- channels do not call core workflow logic with channel-specific payloads
- core runtime does not emit channel-specific response formats
- new channels can be added by implementing adapters against a stable contract

## Design Goal

The protocol should make this architecture real:

`channel -> communication layer -> core runtime -> communication layer -> channel`

In this model:

- channels speak their own transport language at the edge
- the communication layer converts everything into a shared contract
- the core runtime only handles normalized requests and events

## Scope

This protocol is for:

- task start requests
- task progress events
- task completion results
- errors
- lightweight confirmations and follow-up actions

This protocol is not for:

- raw Codex SDK internals
- direct model-provider protocol details
- database schema design

## Design Principles

### 1. Core Is Channel-Agnostic

The core runtime should not know whether a request came from:

- web
- Feishu
- CLI
- a future channel

It should only receive normalized protocol objects.

### 2. Channels Are Pluggable

Every external channel should plug in by implementing the same adapter boundary.

### 3. Events Flow Outward

The core runtime should emit normalized task events.

The communication layer is responsible for mapping them into:

- web responses
- Feishu messages or cards
- operator-facing CLI output

### 4. Minimal MVP Contract

The first version should define only the fields needed for:

- task creation
- task tracking
- result delivery
- memory synchronization visibility

## Protocol Placement

### Layers

- `apps/web/`: first-party desktop UI
- `apps/feishu/`: Feishu integration
- `src/communication/`: protocol definitions, normalization, event routing
- `src/core/`: core workflow execution

### Boundary Rule

Everything outside `src/core/` may know about channels.

Everything inside `src/core/` should depend only on protocol types and core domain types.

## Core Protocol Objects

### 1. `TaskRequest`

Normalized request object created by the communication layer and passed into the core runtime.

Suggested shape:

```ts
type TaskRequest = {
  requestId: string;
  taskId?: string;
  sourceChannel: "web" | "feishu" | "cli" | string;
  user: ChannelUser;
  role: "owner" | "employee";
  workflow: string;
  goal: string;
  inputText?: string;
  historyContext?: string;
  attachments?: TaskAttachment[];
  options?: TaskOptions;
  channelContext: ChannelContext;
  createdAt: string;
};
```

Required meaning:

- `requestId`: idempotency and tracing key for this inbound request
- `taskId`: stable task identifier if this request resumes or follows an existing task
- `sourceChannel`: where the request came from
- `user`: normalized user identity
- `role`: role used for safety defaults
- `workflow`: selected preset such as `implement` or `docs`
- `goal`: the task objective in plain language
- `historyContext`: optional imported transcript used to bootstrap a forked session into a fresh thread
- `channelContext`: channel metadata needed outside the core runtime

Important fork rule:

- `historyContext` is for transcript replay into a new thread
- it should not be treated as proof that the backend created a low-level clone of an existing Codex thread

### 2. `ChannelUser`

Normalized channel user identity.

Suggested shape:

```ts
type ChannelUser = {
  userId: string;
  displayName?: string;
  tenantId?: string;
};
```

This type should be intentionally small in MVP.

### 3. `TaskAttachment`

Optional extra inputs attached to a task request.

Suggested shape:

```ts
type TaskAttachment = {
  id: string;
  type: "text" | "link" | "file" | "image";
  name?: string;
  value: string;
};
```

### 4. `TaskOptions`

Optional overrides carried with the request.

Suggested shape:

```ts
type TaskOptions = {
  profile?: string;
  model?: string;
  reasoning?: "low" | "medium" | "high" | "xhigh";
  memoryMode?: "auto" | "off" | "confirm";
  sandboxMode?: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy?: "never" | "untrusted" | "on-request";
};
```

### 5. `ChannelContext`

Channel-specific metadata that must be preserved for routing, but should not leak into core workflow logic.

Suggested shape:

```ts
type ChannelContext = {
  sessionId?: string;
  threadId?: string;
  messageId?: string;
  replyTarget?: string;
  callbackToken?: string;
  locale?: string;
  rawRef?: string;
};
```

Important rule:

Core runtime may carry this object for tracing, but should not branch business logic on Feishu-specific fields.

Session note:

- `sessionId` should represent the stable Themis conversation identity
- `threadId` may carry the currently bound backend Codex thread when known
- a forked Themis session should usually keep a new `sessionId` even if its first request imports history from an older `threadId`

## Core Event Model

### `TaskEvent`

Normalized event emitted by the core runtime and consumed by the communication layer.

Suggested shape:

```ts
type TaskEvent = {
  eventId: string;
  taskId: string;
  requestId: string;
  type: TaskEventType;
  status: TaskStatus;
  message?: string;
  payload?: Record<string, unknown>;
  timestamp: string;
};
```

### `TaskEventType`

Suggested MVP event types:

- `task.received`
- `task.accepted`
- `task.context_built`
- `task.started`
- `task.progress`
- `task.memory_updated`
- `task.action_required`
- `task.completed`
- `task.failed`
- `task.cancelled`

### `TaskStatus`

Suggested status values:

- `queued`
- `running`
- `waiting`
- `completed`
- `failed`
- `cancelled`

## Result Model

### `TaskResult`

Normalized final result for a task run.

Suggested shape:

```ts
type TaskResult = {
  taskId: string;
  requestId: string;
  status: "completed" | "failed" | "cancelled";
  summary: string;
  output?: string;
  structuredOutput?: Record<string, unknown>;
  touchedFiles?: string[];
  memoryUpdates?: MemoryUpdate[];
  nextSteps?: string[];
  completedAt: string;
};
```

### `MemoryUpdate`

Visible memory changes associated with a task run.

Suggested shape:

```ts
type MemoryUpdate = {
  kind: "session" | "task" | "decision" | "project";
  target: string;
  action: "created" | "updated" | "suggested";
};
```

This keeps memory behavior visible across channels.

## Error Model

### `TaskError`

Normalized error object used across channels.

Suggested shape:

```ts
type TaskError = {
  code:
    | "INVALID_REQUEST"
    | "UNSUPPORTED_WORKFLOW"
    | "AUTH_REQUIRED"
    | "PERMISSION_DENIED"
    | "CHANNEL_PAYLOAD_INVALID"
    | "CORE_RUNTIME_ERROR"
    | "MEMORY_UPDATE_FAILED";
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};
```

This allows channels to decide whether to:

- show a user-friendly error
- ask the user to retry
- escalate to operator logs

## Adapter Contract

### `ChannelAdapter`

Every pluggable channel should implement a shared adapter contract.

Suggested shape:

```ts
type ChannelAdapter = {
  channelId: string;
  canHandle(input: unknown): boolean;
  normalizeRequest(input: unknown): TaskRequest;
  handleEvent(event: TaskEvent): Promise<void>;
  handleResult(result: TaskResult): Promise<void>;
  handleError(error: TaskError, request: TaskRequest): Promise<void>;
};
```

### Adapter Responsibilities

- parse channel-specific payloads
- validate required fields
- construct `TaskRequest`
- render outgoing events and results into channel-specific formats

### Adapter Non-Responsibilities

- building core task prompts
- choosing workflow defaults in ad hoc channel code
- directly manipulating memory files
- calling Codex SDK directly for normal task execution

## Web Contract

Even though web is a first-party surface, it should still reuse the same normalized contract.

Recommended approach:

- web form submission becomes a `TaskRequest`
- progress stream is based on `TaskEvent`
- task completion page consumes `TaskResult`

This keeps web behavior aligned with Feishu and future channels.

## Feishu Contract

Feishu-specific behavior should stay in the Feishu adapter.

Examples:

- signature verification
- callback token handling
- message card generation
- chat reply routing

But once normalized, Feishu should produce the same `TaskRequest` shape as any other channel.

## Request Lifecycle

### 1. Inbound Request

The channel adapter receives a raw channel payload.

### 2. Normalization

The adapter converts that payload into `TaskRequest`.

### 3. Core Execution

The core runtime processes `TaskRequest` and emits `TaskEvent`.

### 4. Event Routing

The communication layer sends `TaskEvent` to the relevant adapter.

### 5. Final Result

The core runtime emits `TaskResult`.

### 6. Channel Delivery

The adapter renders the final output for its channel.

## Idempotency And Tracing

MVP should include:

- `requestId` on every inbound request
- `taskId` on every long-lived task
- `eventId` on every emitted event

This will help with:

- deduplication
- retries
- audit logs
- debugging cross-channel issues

## Confirmation And Follow-Up Model

Some channels, especially Feishu, may need lightweight follow-up actions such as:

- confirm an elevated action
- request a status refresh
- continue a paused task

These should be represented as new normalized requests rather than side-loading channel-specific control logic into the core.

## MVP Recommendation

For MVP, implement only:

- one inbound task-start request shape
- one outbound progress event shape
- one outbound final result shape
- one normalized error shape
- one adapter interface

Do not over-design the protocol before real traffic exists.

## Relationship To Other Docs

This protocol supports:

- [Themis Channel Design](/home/gyyxs88/Projects/Themis/docs/product/themis-channel-design.md)
- [Themis MVP Technical Architecture](/home/gyyxs88/Projects/Themis/docs/product/themis-mvp-technical-architecture.md)
- [Themis Product Design Input](/home/gyyxs88/Projects/Themis/docs/product/themis-product-design-input.md)
