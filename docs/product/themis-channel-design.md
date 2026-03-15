# Themis Channel Design

## Purpose

This document defines the user-facing channel strategy for Themis.

The goal is to make Themis genuinely easy for employees to use, rather than simply wrapping Codex in another CLI.

## Channel Strategy

Themis should have three interaction channels, but only two of them are employee-facing:

### 1. LAN Web Frontend

Role:

- primary employee-facing desktop interface

Main value:

- guided workflow selection
- visible progress
- visual memory browsing
- lower onboarding cost

### 2. Feishu Plugin Or Bot Interface

Role:

- primary mobile and chat interface

Main value:

- accessible from existing work habits
- convenient from phone
- better for quick requests and status follow-up

### 3. Operator CLI

Role:

- developer and operator support tool

Main value:

- debugging
- maintenance
- direct control during development

## Communication Layer

External channels should not connect directly to the Themis core.

Instead, Themis should define a shared communication layer between channels and the core workflow runtime.

In this model:

- Feishu plugs into the communication layer
- future channels plug into the same communication layer
- Themis core receives normalized requests instead of channel-specific payloads

## Why The Communication Layer Matters

Without this layer, every new channel tends to copy the same logic:

- auth handling
- request parsing
- workflow request construction
- progress event mapping
- result formatting

That creates tight coupling and makes future channel additions slower and riskier.

With a communication layer, channel-specific complexity stays outside the core runtime.

## Communication Layer Responsibilities

- accept channel events and requests
- convert them into a shared Themis request model
- map internal progress events to channel-safe responses
- isolate channel auth and callback formats
- standardize notification and reply behavior

## Channel Plug-In Model

Recommended structure:

- web frontend talks to Themis application APIs using the same normalized request and result contract
- Feishu adapter plugs into the communication layer
- future adapters such as WeCom, DingTalk, Telegram, or email can plug into the same layer

This keeps channel expansion additive rather than invasive.

## Why Web And Feishu Should Be The Main Product Surfaces

The employee usability problem is not that Codex is missing features.

It is that employees are being asked to use a technical interaction mode that is harder than their real work requires.

A better product strategy is to let employees interact with workflows through:

- forms
- buttons
- prebuilt task types
- visible task status
- conversational mobile entrypoints

## Web Frontend Design Goals

The LAN web frontend should make the system feel approachable and inspectable.

Key goals:

- easy task creation
- clear workflow choices
- visible role and safety state
- readable progress updates
- direct access to memory and task history

## Suggested Web MVP Screens

### Home

Show:

- available workflow presets
- current active tasks
- recent results
- quick links into memory

### New Task

Show:

- workflow picker
- task goal input
- optional attachments or supporting text
- safety and role indicators

### Task Detail

Show:

- current status
- progress log
- final result
- files touched
- memory updates made

### Memory

Show:

- active session summary
- backlog, in-progress, and done task views
- decision record list

## Feishu Interface Design Goals

The Feishu interface should optimize for speed and convenience, not maximum complexity.

Key goals:

- start a common workflow quickly
- ask for status updates
- receive result summaries
- handle simple confirmation steps
- work well on mobile

## Suggested Feishu MVP Scope

Best-fit MVP capabilities:

- start a task from a message or form-like interaction
- choose from a small workflow list
- receive progress notifications
- receive final summary and next-step suggestions
- query current task status

Avoid in MVP:

- very long multi-step configuration flows
- overly complex document editing from chat
- exposing every low-level setting to end users

## Shared Workflow Core

Web and Feishu should not become two separate products.

They should share:

- the same communication contracts where applicable
- the same workflow preset registry
- the same session orchestration
- the same safety rules
- the same memory integration
- the same result model

This is critical to keeping behavior predictable and maintainable.

## Recommended Interaction Split

### Better Suited To Web

- starting complex tasks
- reviewing detailed progress
- browsing memory and decisions
- owner or admin management actions

### Better Suited To Feishu

- quick requests
- lightweight documentation asks
- task status follow-up
- notification and confirmation flows

## UX Principle

Users should feel they are choosing a task, not configuring an agent.

That is the core difference between a useful employee product and a thin technical wrapper.

## Channel Design Summary

Themis should be:

- web-first for internal desktop use
- Feishu-enabled for chat and mobile use
- communication-layer-based for channel extensibility
- CLI-supported for technical operators
