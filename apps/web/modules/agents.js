const PRIORITIES = ["low", "normal", "high", "urgent"];
const SOURCE_TYPES = ["human", "agent", "system"];

function createDefaultCreateDraft() {
  return {
    departmentRole: "",
    displayName: "",
    mission: "",
  };
}

function createDefaultDispatchDraft() {
  return {
    targetAgentId: "",
    sourceType: "human",
    sourceAgentId: "",
    dispatchReason: "",
    goal: "",
    contextPacketText: "",
    priority: "normal",
  };
}

function createDefaultHumanResponseDraft() {
  return {
    workItemId: "",
    decision: "",
    inputText: "",
  };
}

function createDefaultOrganizationWaitingResponseDraft() {
  return {
    decision: "",
    inputText: "",
  };
}

function createDefaultGovernanceFilters() {
  return {
    organizationId: "",
    managerAgentId: "",
    attentionLevel: "all",
    waitingFor: "any",
    staleOnly: false,
    failedOnly: false,
    limit: 20,
  };
}

function createDefaultSpawnPolicyDraft() {
  return {
    organizationId: "",
    maxActiveAgents: 12,
    maxActiveAgentsPerRole: 3,
  };
}

function createDefaultExecutionBoundaryDraft() {
  return {
    workspacePath: "",
    additionalDirectoriesText: "",
    allowNetworkAccess: true,
    accessMode: "auth",
    authAccountId: "",
    thirdPartyProviderId: "",
    model: "",
    reasoning: "",
    memoryMode: "",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    webSearchMode: "live",
    networkAccessEnabled: true,
  };
}

function createDefaultCompatibilityStatus() {
  return null;
}

export function createDefaultAgentsState() {
  return {
    status: "idle",
    errorMessage: "",
    noticeMessage: "",
    loading: false,
    detailLoading: false,
    workItemDetailLoading: false,
    creating: false,
    dispatching: false,
    updatingSpawnPolicy: false,
    savingExecutionBoundary: false,
    approvingSpawnSuggestionId: "",
    approvingIdleRecoverySuggestionId: "",
    ignoringSpawnSuggestionId: "",
    rejectingSpawnSuggestionId: "",
    restoringSpawnSuggestionId: "",
    ackingMailboxEntryId: "",
    cancelingWorkItemId: "",
    escalatingWorkItemId: "",
    respondingWorkItemId: "",
    lifecycleUpdatingAgentId: "",
    lifecycleUpdatingAction: "",
    compatibilityStatus: createDefaultCompatibilityStatus(),
    organizations: [],
    agents: [],
    organizationGovernanceOverview: null,
    organizationWaitingSummary: null,
    organizationWaitingItems: [],
    organizationCollaborationSummary: null,
    organizationCollaborationItems: [],
    spawnPolicies: [],
    spawnSuggestions: [],
    suppressedSpawnSuggestions: [],
    spawnAuditLogs: [],
    idleRecoverySuggestions: [],
    idleRecoveryAuditLogs: [],
    governanceFilters: createDefaultGovernanceFilters(),
    organizationWaitingResponseDrafts: {},
    selectedAgentId: "",
    selectedAgent: null,
    selectedAgentPrincipal: null,
    selectedOrganization: null,
    selectedWorkspacePolicy: null,
    selectedRuntimeProfile: null,
    availableAuthAccounts: [],
    availableThirdPartyProviders: [],
    handoffs: [],
    handoffTimeline: [],
    workItems: [],
    mailboxItems: [],
    selectedWorkItemId: "",
    selectedWorkItemDetail: null,
    humanResponseDraft: createDefaultHumanResponseDraft(),
    spawnPolicyDraft: createDefaultSpawnPolicyDraft(),
    executionBoundaryDraft: createDefaultExecutionBoundaryDraft(),
    createDraft: createDefaultCreateDraft(),
    dispatchDraft: createDefaultDispatchDraft(),
  };
}

export function createAgentsController(app) {
  const { dom } = app;
  let controlsBound = false;
  let loadRequestId = 0;
  let detailRequestId = 0;
  let workItemDetailRequestId = 0;

  function bindControls() {
    if (controlsBound) {
      return;
    }

    controlsBound = true;
    const runSafely = async (action) => {
      try {
        await action();
      } catch {
        // Errors are already reflected in agents state for the UI.
      }
    };

    dom?.agentsRefreshButton?.addEventListener("click", () => {
      void runSafely(load);
    });

    dom?.agentsCreateButton?.addEventListener("click", () => {
      void runSafely(createAgent);
    });

    dom?.agentsSelect?.addEventListener("change", () => {
      void runSafely(() => selectAgent(dom.agentsSelect?.value || ""));
    });

    dom?.agentsCreateRoleInput?.addEventListener("input", () => {
      updateCreateDraft({
        departmentRole: dom.agentsCreateRoleInput?.value ?? "",
      });
    });

    dom?.agentsCreateNameInput?.addEventListener("input", () => {
      updateCreateDraft({
        displayName: dom.agentsCreateNameInput?.value ?? "",
      });
    });

    dom?.agentsCreateMissionInput?.addEventListener("input", () => {
      updateCreateDraft({
        mission: dom.agentsCreateMissionInput?.value ?? "",
      });
    });

    dom?.agentsDispatchTargetSelect?.addEventListener("change", () => {
      updateDispatchDraft({
        targetAgentId: dom.agentsDispatchTargetSelect?.value ?? "",
      });
    });

    dom?.agentsDispatchSourceTypeSelect?.addEventListener("change", () => {
      const sourceType = normalizeSourceType(dom.agentsDispatchSourceTypeSelect?.value);
      const state = app.runtime.agents ?? createDefaultAgentsState();
      updateDispatchDraft({
        sourceType,
        sourceAgentId: sourceType === "agent"
          ? resolveSourceAgentId(state.dispatchDraft.sourceAgentId, state.agents, state.dispatchDraft.targetAgentId)
          : "",
      });
    });

    dom?.agentsDispatchSourceAgentSelect?.addEventListener("change", () => {
      updateDispatchDraft({
        sourceAgentId: dom.agentsDispatchSourceAgentSelect?.value ?? "",
      });
    });

    dom?.agentsDispatchReasonInput?.addEventListener("input", () => {
      updateDispatchDraft({
        dispatchReason: dom.agentsDispatchReasonInput?.value ?? "",
      });
    });

    dom?.agentsDispatchGoalInput?.addEventListener("input", () => {
      updateDispatchDraft({
        goal: dom.agentsDispatchGoalInput?.value ?? "",
      });
    });

    dom?.agentsDispatchContextInput?.addEventListener("input", () => {
      updateDispatchDraft({
        contextPacketText: dom.agentsDispatchContextInput?.value ?? "",
      });
    });

    dom?.agentsDispatchPrioritySelect?.addEventListener("change", () => {
      updateDispatchDraft({
        priority: normalizePriority(dom.agentsDispatchPrioritySelect?.value),
      });
    });

    dom?.agentsDispatchButton?.addEventListener("click", () => {
      void runSafely(dispatchWorkItem);
    });

    dom?.agentsList?.addEventListener("click", (event) => {
      const selectButton = event.target.closest("[data-agent-select]");

      if (selectButton?.dataset.agentSelect) {
        void runSafely(() => selectAgent(selectButton.dataset.agentSelect));
      }
    });

    dom?.agentsSelectedAgentMeta?.addEventListener("click", (event) => {
      const lifecycleButton = event.target.closest("[data-agent-lifecycle-action]");

      if (!lifecycleButton?.dataset.agentLifecycleAction) {
        return;
      }

      const action = normalizeLifecycleAction(lifecycleButton.dataset.agentLifecycleAction);
      const agentId = normalizeText(lifecycleButton.dataset.agentLifecycleAgentId)
        || normalizeText(app.runtime.agents?.selectedAgentId);

      if (!action || !agentId) {
        return;
      }

      void runSafely(() => updateManagedAgentLifecycle(agentId, action));
    });

    dom?.agentsExecutionBoundaryWorkspaceInput?.addEventListener("input", () => {
      updateExecutionBoundaryDraft({
        workspacePath: dom.agentsExecutionBoundaryWorkspaceInput?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryAdditionalDirsInput?.addEventListener("input", () => {
      updateExecutionBoundaryDraft({
        additionalDirectoriesText: dom.agentsExecutionBoundaryAdditionalDirsInput?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryPolicyNetworkSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        allowNetworkAccess: dom.agentsExecutionBoundaryPolicyNetworkSelect?.value !== "false",
      });
    });

    dom?.agentsExecutionBoundaryAccessModeSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        accessMode: normalizeText(dom.agentsExecutionBoundaryAccessModeSelect?.value) === "third-party"
          ? "third-party"
          : "auth",
      });
    });

    dom?.agentsExecutionBoundaryAuthAccountSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        authAccountId: dom.agentsExecutionBoundaryAuthAccountSelect?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryProviderSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        thirdPartyProviderId: dom.agentsExecutionBoundaryProviderSelect?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryModelInput?.addEventListener("input", () => {
      updateExecutionBoundaryDraft({
        model: dom.agentsExecutionBoundaryModelInput?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryReasoningSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        reasoning: dom.agentsExecutionBoundaryReasoningSelect?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryMemoryModeSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        memoryMode: dom.agentsExecutionBoundaryMemoryModeSelect?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundarySandboxSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        sandboxMode: dom.agentsExecutionBoundarySandboxSelect?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryApprovalSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        approvalPolicy: dom.agentsExecutionBoundaryApprovalSelect?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryWebSearchSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        webSearchMode: dom.agentsExecutionBoundaryWebSearchSelect?.value ?? "",
      });
    });

    dom?.agentsExecutionBoundaryRuntimeNetworkSelect?.addEventListener("change", () => {
      updateExecutionBoundaryDraft({
        networkAccessEnabled: dom.agentsExecutionBoundaryRuntimeNetworkSelect?.value !== "false",
      });
    });

    dom?.agentsExecutionBoundarySaveButton?.addEventListener("click", () => {
      void runSafely(saveExecutionBoundary);
    });

    dom?.agentsGovernanceFilterManagerSelect?.addEventListener("change", () => {
      void runSafely(() => applyGovernanceFilters({
        managerAgentId: dom.agentsGovernanceFilterManagerSelect?.value ?? "",
      }));
    });

    dom?.agentsGovernanceFilterAttentionSelect?.addEventListener("change", () => {
      void runSafely(() => applyGovernanceFilters({
        attentionLevel: normalizeGovernanceAttentionLevel(dom.agentsGovernanceFilterAttentionSelect?.value),
      }));
    });

    dom?.agentsGovernanceFilterWaitingSelect?.addEventListener("change", () => {
      void runSafely(() => applyGovernanceFilters({
        waitingFor: normalizeGovernanceWaitingFor(dom.agentsGovernanceFilterWaitingSelect?.value),
      }));
    });

    dom?.agentsGovernanceFilterStaleInput?.addEventListener("change", () => {
      void runSafely(() => applyGovernanceFilters({
        staleOnly: dom.agentsGovernanceFilterStaleInput?.checked === true,
      }));
    });

    dom?.agentsGovernanceFilterFailedInput?.addEventListener("change", () => {
      void runSafely(() => applyGovernanceFilters({
        failedOnly: dom.agentsGovernanceFilterFailedInput?.checked === true,
      }));
    });

    dom?.agentsGovernanceFilterResetButton?.addEventListener("click", () => {
      void runSafely(resetGovernanceFilters);
    });

    dom?.agentsGovernanceSummaryGrid?.addEventListener("click", (event) => {
      const summaryButton = event.target.closest("[data-agent-governance-preset]");

      if (!summaryButton?.dataset.agentGovernancePreset) {
        return;
      }

      void runSafely(() => applyGovernancePreset(summaryButton.dataset.agentGovernancePreset));
    });

    dom?.agentsGovernanceHotspotsList?.addEventListener("click", (event) => {
      const filterButton = event.target.closest("[data-agent-governance-hotspot-filter]");

      if (filterButton?.dataset.agentGovernanceHotspotFilter) {
        void runSafely(() => applyGovernanceFilters({
          managerAgentId: filterButton.dataset.agentGovernanceHotspotFilter,
        }));
        return;
      }

      const focusButton = event.target.closest("[data-agent-governance-hotspot-focus]");

      if (!focusButton?.dataset.agentGovernanceHotspotFocus) {
        return;
      }

      void runSafely(() => selectAgent(focusButton.dataset.agentGovernanceHotspotFocus));
    });

    dom?.agentsWaitingList?.addEventListener("click", (event) => {
      const escalateButton = event.target.closest("[data-agent-waiting-escalate]");

      if (escalateButton?.dataset.agentWaitingEscalate) {
        void runSafely(() => escalateOrganizationWaitingWorkItem(escalateButton.dataset.agentWaitingEscalate));
        return;
      }

      const respondButton = event.target.closest("[data-agent-waiting-respond]");

      if (respondButton?.dataset.agentWaitingRespond) {
        void runSafely(() => respondOrganizationWaitingWorkItem(respondButton.dataset.agentWaitingRespond));
        return;
      }

      const parentButton = event.target.closest("[data-agent-waiting-parent-open]");

      if (parentButton?.dataset.agentWaitingParentOpen) {
        const targetAgentId = normalizeText(parentButton.dataset.agentWaitingParentAgentId);
        const workItemId = normalizeText(parentButton.dataset.agentWaitingParentOpen);

        if (!targetAgentId || !workItemId) {
          return;
        }

        void runSafely(() => load({
          preserveNoticeMessage: true,
          selectAgentId: targetAgentId,
          selectWorkItemId: workItemId,
        }));
        return;
      }

      const jumpButton = event.target.closest("[data-agent-waiting-open]");

      if (!jumpButton?.dataset.agentWaitingOpen) {
        return;
      }

      const targetAgentId = normalizeText(jumpButton.dataset.agentWaitingAgentId);
      const workItemId = normalizeText(jumpButton.dataset.agentWaitingOpen);

      if (!targetAgentId || !workItemId) {
        return;
      }

      void runSafely(() => load({
        preserveNoticeMessage: true,
        selectAgentId: targetAgentId,
        selectWorkItemId: workItemId,
      }));
    });

    dom?.agentsWaitingList?.addEventListener("input", (event) => {
      const decisionInput = event.target.closest("[data-agent-waiting-decision]");

      if (decisionInput?.dataset.agentWaitingDecision) {
        updateOrganizationWaitingResponseDraft(decisionInput.dataset.agentWaitingDecision, {
          decision: normalizeHumanDecision(decisionInput.value),
        });
        return;
      }

      const inputTextArea = event.target.closest("[data-agent-waiting-input]");

      if (inputTextArea?.dataset.agentWaitingInput) {
        updateOrganizationWaitingResponseDraft(inputTextArea.dataset.agentWaitingInput, {
          inputText: inputTextArea.value ?? "",
        });
      }
    });

    dom?.agentsCollaborationList?.addEventListener("click", (event) => {
      const openButton = event.target.closest("[data-agent-collaboration-open]");

      if (openButton?.dataset.agentCollaborationOpen) {
        const targetAgentId = normalizeText(openButton.dataset.agentCollaborationAgentId);
        const workItemId = normalizeText(openButton.dataset.agentCollaborationOpen);

        if (!targetAgentId || !workItemId) {
          return;
        }

        void runSafely(() => load({
          preserveNoticeMessage: true,
          selectAgentId: targetAgentId,
          selectWorkItemId: workItemId,
        }));
        return;
      }

      const focusButton = event.target.closest("[data-agent-collaboration-focus]");

      if (focusButton?.dataset.agentCollaborationFocus) {
        void runSafely(() => selectAgent(focusButton.dataset.agentCollaborationFocus));
        return;
      }

      const waitingButton = event.target.closest("[data-agent-collaboration-waiting-open]");

      if (waitingButton?.dataset.agentCollaborationWaitingOpen) {
        const targetAgentId = normalizeText(waitingButton.dataset.agentCollaborationWaitingAgentId);
        const workItemId = normalizeText(waitingButton.dataset.agentCollaborationWaitingOpen);

        if (!targetAgentId || !workItemId) {
          return;
        }

        void runSafely(() => load({
          preserveNoticeMessage: true,
          selectAgentId: targetAgentId,
          selectWorkItemId: workItemId,
        }));
        return;
      }

      const lifecycleButton = event.target.closest("[data-agent-collaboration-lifecycle]");

      if (!lifecycleButton?.dataset.agentCollaborationLifecycle) {
        return;
      }

      const action = normalizeLifecycleAction(lifecycleButton.dataset.agentCollaborationLifecycle);
      const agentId = normalizeText(lifecycleButton.dataset.agentCollaborationLifecycleAgentId);

      if (!action || !agentId) {
        return;
      }

      void runSafely(() => updateManagedAgentLifecycle(agentId, action));
    });

    dom?.agentsSpawnSuggestionsList?.addEventListener("click", (event) => {
      const approveButton = event.target.closest("[data-agent-spawn-approve]");

      if (approveButton?.dataset.agentSpawnApprove) {
        void runSafely(() => approveSpawnSuggestion(approveButton.dataset.agentSpawnApprove));
        return;
      }

      const ignoreButton = event.target.closest("[data-agent-spawn-ignore]");

      if (ignoreButton?.dataset.agentSpawnIgnore) {
        void runSafely(() => ignoreSpawnSuggestion(ignoreButton.dataset.agentSpawnIgnore));
        return;
      }

      const rejectButton = event.target.closest("[data-agent-spawn-reject]");

      if (rejectButton?.dataset.agentSpawnReject) {
        void runSafely(() => rejectSpawnSuggestion(rejectButton.dataset.agentSpawnReject));
      }
    });

    dom?.agentsSuppressedSpawnSuggestionsList?.addEventListener("click", (event) => {
      const restoreButton = event.target.closest("[data-agent-spawn-restore]");

      if (!restoreButton?.dataset.agentSpawnRestore) {
        return;
      }

      void runSafely(() => restoreSpawnSuggestion(restoreButton.dataset.agentSpawnRestore));
    });

    dom?.agentsIdleRecoverySuggestionsList?.addEventListener("click", (event) => {
      const approveButton = event.target.closest("[data-agent-idle-approve]");

      if (!approveButton?.dataset.agentIdleApprove) {
        return;
      }

      void runSafely(() => approveIdleRecoverySuggestion(approveButton.dataset.agentIdleApprove));
    });

    dom?.agentsSpawnPolicyMaxActiveInput?.addEventListener("input", () => {
      updateSpawnPolicyDraft({
        maxActiveAgents: normalizePositiveIntegerInput(dom.agentsSpawnPolicyMaxActiveInput?.value, 1),
      });
    });

    dom?.agentsSpawnPolicyMaxRoleInput?.addEventListener("input", () => {
      updateSpawnPolicyDraft({
        maxActiveAgentsPerRole: normalizePositiveIntegerInput(dom.agentsSpawnPolicyMaxRoleInput?.value, 1),
      });
    });

    dom?.agentsSpawnPolicySaveButton?.addEventListener("click", () => {
      void runSafely(saveSpawnPolicy);
    });

    dom?.agentsWorkItemsList?.addEventListener("click", (event) => {
      const detailButton = event.target.closest("[data-agent-work-item-select]");

      if (detailButton?.dataset.agentWorkItemSelect) {
        void runSafely(() => loadWorkItemDetail(detailButton.dataset.agentWorkItemSelect, {
          preserveNoticeMessage: true,
        }));
      }
    });

    dom?.agentsWorkItemDetail?.addEventListener("input", (event) => {
      const decisionInput = event.target.closest("[data-agent-human-decision]");

      if (decisionInput) {
        updateHumanResponseDraft({
          decision: normalizeHumanDecision(decisionInput.value),
        });
        return;
      }

      const inputTextArea = event.target.closest("[data-agent-human-input]");

      if (inputTextArea) {
        updateHumanResponseDraft({
          inputText: inputTextArea.value ?? "",
        });
      }
    });

    dom?.agentsWorkItemDetail?.addEventListener("click", (event) => {
      const cancelButton = event.target.closest("[data-agent-work-item-cancel]");

      if (cancelButton?.dataset.agentWorkItemCancel) {
        void runSafely(() => cancelWorkItem(cancelButton.dataset.agentWorkItemCancel));
        return;
      }

      const respondButton = event.target.closest("[data-agent-human-respond]");

      if (respondButton?.dataset.agentHumanRespond) {
        void runSafely(() => respondHumanWaitingWorkItem(respondButton.dataset.agentHumanRespond));
      }
    });

    dom?.agentsMailboxList?.addEventListener("click", (event) => {
      const ackButton = event.target.closest("[data-agent-mailbox-ack]");

      if (!ackButton) {
        return;
      }

      const mailboxEntryId = normalizeText(ackButton.dataset.agentMailboxAck);
      const agentId = normalizeText(ackButton.dataset.agentMailboxOwnerId)
        || normalizeText(app.runtime.agents?.selectedAgentId);

      if (!mailboxEntryId || !agentId) {
        return;
      }

      void runSafely(() => ackMailboxEntry(mailboxEntryId, agentId));
    });

    dom?.workspaceToolsPanel?.addEventListener("click", (event) => {
      const sectionButton = event.target.closest("[data-settings-section]");

      if (sectionButton?.dataset.settingsSection === "agents") {
        void runSafely(load);
      }
    });

    dom?.workspaceToolsToggle?.addEventListener("click", () => {
      queueMicrotask(() => {
        if (app.runtime.workspaceToolsOpen && app.runtime.workspaceToolsSection === "agents") {
          void runSafely(load);
        }
      });
    });
  }

  function setState(patch) {
    app.runtime.agents = {
      ...app.runtime.agents,
      ...patch,
    };
  }

  function render() {
    app.renderer?.renderAll?.();
  }

  function updateCreateDraft(patch) {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    setState({
      createDraft: {
        ...state.createDraft,
        ...patch,
      },
    });
    render();
  }

  function updateDispatchDraft(patch) {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    setState({
      dispatchDraft: {
        ...state.dispatchDraft,
        ...patch,
      },
    });
    render();
  }

  function updateHumanResponseDraft(patch) {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const baseDraft = syncHumanResponseDraft(state.humanResponseDraft, state.selectedWorkItemDetail);

    setState({
      humanResponseDraft: {
        ...baseDraft,
        ...patch,
      },
    });
    render();
  }

  function updateOrganizationWaitingResponseDraft(workItemId, patch) {
    const normalizedWorkItemId = normalizeText(workItemId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const waitingItem = resolveOrganizationWaitingWorkItem(state.organizationWaitingItems, normalizedWorkItemId);

    if (!waitingItem) {
      return;
    }

    const nextDraft = {
      ...syncOrganizationWaitingResponseDraft(
        state.organizationWaitingResponseDrafts?.[normalizedWorkItemId],
        waitingItem,
      ),
      ...patch,
      decision: patch && "decision" in patch ? normalizeHumanDecision(patch.decision) : normalizeHumanDecision(
        state.organizationWaitingResponseDrafts?.[normalizedWorkItemId]?.decision,
      ),
    };
    const nextDrafts = {
      ...syncOrganizationWaitingResponseDrafts(
        state.organizationWaitingResponseDrafts,
        state.organizationWaitingItems,
      ),
      [normalizedWorkItemId]: nextDraft,
    };
    const selectedWorkItemId = normalizeText(state.selectedWorkItemId);

    setState({
      organizationWaitingResponseDrafts: nextDrafts,
      ...(selectedWorkItemId === normalizedWorkItemId
        ? {
            humanResponseDraft: {
              workItemId: normalizedWorkItemId,
              decision: nextDraft.decision,
              inputText: nextDraft.inputText,
            },
          }
        : {}),
    });
    render();
  }

  function updateSpawnPolicyDraft(patch) {
    const state = app.runtime.agents ?? createDefaultAgentsState();

    setState({
      spawnPolicyDraft: {
        ...syncSpawnPolicyDraft(
          state.spawnPolicyDraft,
          state.spawnPolicies,
          resolveSpawnPolicyOrganizationId(state),
        ),
        ...patch,
      },
    });
    render();
  }

  function updateExecutionBoundaryDraft(patch) {
    const state = app.runtime.agents ?? createDefaultAgentsState();

    setState({
      executionBoundaryDraft: {
        ...(isRecord(state.executionBoundaryDraft)
          ? state.executionBoundaryDraft
          : createDefaultExecutionBoundaryDraft()),
        ...patch,
      },
    });
    render();
  }

  function updateGovernanceFilters(patch) {
    const state = app.runtime.agents ?? createDefaultAgentsState();

    setState({
      governanceFilters: {
        ...syncGovernanceFilters(state.governanceFilters, state.organizations, state.agents),
        ...patch,
      },
    });
    render();
  }

  async function applyGovernanceFilters(patch) {
    updateGovernanceFilters(patch);
    await load({
      preserveNoticeMessage: true,
    });
  }

  async function resetGovernanceFilters() {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    setState({
      governanceFilters: syncGovernanceFilters(
        createDefaultGovernanceFilters(),
        state.organizations,
        state.agents,
      ),
    });
    render();
    await load({
      preserveNoticeMessage: true,
    });
  }

  async function applyGovernancePreset(preset) {
    const normalizedPreset = normalizeText(preset);
    const nextFilters = {
      ...createDefaultGovernanceFilters(),
    };

    if (normalizedPreset === "urgent") {
      nextFilters.attentionLevel = "urgent";
    } else if (normalizedPreset === "attention") {
      nextFilters.attentionLevel = "attention";
    } else if (normalizedPreset === "waiting_human") {
      nextFilters.waitingFor = "human";
    } else if (normalizedPreset === "waiting_agent") {
      nextFilters.waitingFor = "agent";
    } else if (normalizedPreset === "stale") {
      nextFilters.staleOnly = true;
    }

    await applyGovernanceFilters(nextFilters);
  }

  async function load(options = {}) {
    const requestId = ++loadRequestId;
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const preserveNoticeMessage = options.preserveNoticeMessage === true;

    setState({
      loading: true,
      errorMessage: "",
      ...(preserveNoticeMessage ? {} : { noticeMessage: "" }),
    });
    render();

    try {
      const [data, suggestionsData, idleRecoveryData] = await Promise.all([
        postAgents("/api/agents/list", buildIdentityPayload(app)),
        postAgents("/api/agents/spawn-suggestions", buildIdentityPayload(app)),
        postAgents("/api/agents/idle-suggestions", buildIdentityPayload(app)),
      ]);

      if (requestId !== loadRequestId) {
        return app.runtime.agents;
      }

      const organizations = normalizeOrganizations(data.organizations);
      const compatibilityStatus = normalizeAgentsCompatibilityStatus(data.compatibility);
      const agents = normalizeAgents(data.agents);
      const governanceFilters = syncGovernanceFilters(state.governanceFilters, organizations, agents);
      const governancePayload = {
        ...buildIdentityPayload(app),
        ...buildGovernanceFiltersPayload(governanceFilters),
      };
      const [overviewData, waitingData, collaborationData] = await Promise.all([
        postAgents("/api/agents/governance-overview", governancePayload)
          .catch(() => createEmptyGovernanceOverviewResponse()),
        postAgents("/api/agents/waiting/list", governancePayload),
        postAgents("/api/agents/collaboration-dashboard", governancePayload)
          .catch(() => createEmptyCollaborationDashboardResponse()),
      ]);

      if (requestId !== loadRequestId) {
        return app.runtime.agents;
      }

      const waitingItems = normalizeWaitingItems(waitingData.items);
      const collaborationItems = normalizeCollaborationDashboardItems(collaborationData.items);
      const spawnPolicies = normalizeSpawnPolicies(suggestionsData.spawnPolicies);
      const spawnSuggestions = normalizeSpawnSuggestions(suggestionsData.suggestions);
      const suppressedSpawnSuggestions = normalizeSuppressedSpawnSuggestions(suggestionsData.suppressedSuggestions);
      const spawnAuditLogs = normalizeSpawnAuditLogs(suggestionsData.recentAuditLogs);
      const idleRecoverySuggestions = normalizeIdleRecoverySuggestions(idleRecoveryData.suggestions);
      const idleRecoveryAuditLogs = normalizeIdleRecoveryAuditLogs(idleRecoveryData.recentAuditLogs);
      const selectedAgentId = resolveAgentId(options.selectAgentId || state.selectedAgentId, agents);
      const dispatchDraft = syncDispatchDraft(state.dispatchDraft, agents, selectedAgentId);
      const spawnPolicyDraft = syncSpawnPolicyDraft(
        state.spawnPolicyDraft,
        spawnPolicies,
        resolveSpawnPolicyOrganizationId({
          ...state,
          agents,
          selectedAgentId,
        }),
      );

      setState({
        status: "ready",
        loading: false,
        compatibilityStatus,
        organizations,
        agents,
        organizationGovernanceOverview: normalizeGovernanceOverview(overviewData.overview),
        organizationWaitingSummary: normalizeWaitingSummary(waitingData.summary),
        organizationWaitingItems: waitingItems,
        organizationCollaborationSummary: normalizeCollaborationDashboardSummary(collaborationData.summary),
        organizationCollaborationItems: collaborationItems,
        spawnPolicies,
        spawnSuggestions,
        suppressedSpawnSuggestions,
        spawnAuditLogs,
        idleRecoverySuggestions,
        idleRecoveryAuditLogs,
        spawnPolicyDraft,
        governanceFilters,
        organizationWaitingResponseDrafts: syncOrganizationWaitingResponseDrafts(
          state.organizationWaitingResponseDrafts,
          waitingItems,
        ),
        selectedAgentId,
        dispatchDraft,
        errorMessage: "",
      });
      render();

      await loadSelectedAgentData(selectedAgentId, {
        preserveNoticeMessage: true,
        selectWorkItemId: options.selectWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      if (requestId !== loadRequestId) {
        return app.runtime.agents;
      }

      setState({
        status: "error",
        loading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function loadSelectedAgentData(agentId, options = {}) {
    const normalizedAgentId = normalizeText(agentId);
    const preserveNoticeMessage = options.preserveNoticeMessage === true;

    if (!normalizedAgentId) {
      setState({
        detailLoading: false,
        selectedAgentId: "",
        selectedAgent: null,
        selectedAgentPrincipal: null,
        selectedOrganization: null,
        selectedWorkspacePolicy: null,
        selectedRuntimeProfile: null,
        availableAuthAccounts: [],
        availableThirdPartyProviders: [],
        handoffs: [],
        handoffTimeline: [],
        workItems: [],
        mailboxItems: [],
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        executionBoundaryDraft: createDefaultExecutionBoundaryDraft(),
        humanResponseDraft: createDefaultHumanResponseDraft(),
      });
      render();
      return app.runtime.agents;
    }

    const requestId = ++detailRequestId;
    setState({
      detailLoading: true,
      errorMessage: "",
      ...(preserveNoticeMessage ? {} : { noticeMessage: "" }),
    });
    render();

    try {
      const identity = buildIdentityPayload(app);
      const [detailData, workItemsData, mailboxData, handoffData] = await Promise.all([
        postAgents("/api/agents/detail", {
          ...identity,
          agentId: normalizedAgentId,
        }),
        postAgents("/api/agents/work-items/list", {
          ...identity,
          agentId: normalizedAgentId,
        }),
        postAgents("/api/agents/mailbox/list", {
          ...identity,
          agentId: normalizedAgentId,
        }),
        postAgents("/api/agents/handoffs/list", {
          ...identity,
          agentId: normalizedAgentId,
        }),
      ]);

      if (requestId !== detailRequestId) {
        return app.runtime.agents;
      }

      const workItems = normalizeWorkItems(workItemsData.workItems);
      const mailboxItems = normalizeMailboxItems(mailboxData.items);
      const handoffs = normalizeHandoffs(handoffData.handoffs);
      const handoffTimeline = normalizeHandoffTimeline(handoffData.timeline);
      const workspacePolicy = normalizeExecutionWorkspacePolicy(detailData.workspacePolicy);
      const runtimeProfile = normalizeExecutionRuntimeProfile(detailData.runtimeProfile);
      const availableAuthAccounts = normalizeAuthAccounts(detailData.authAccounts);
      const availableThirdPartyProviders = normalizeThirdPartyProviders(detailData.thirdPartyProviders);
      const state = app.runtime.agents ?? createDefaultAgentsState();
      const selectedWorkItemId = resolveWorkItemId(options.selectWorkItemId || state.selectedWorkItemId, workItems);
      const spawnPolicyDraft = syncSpawnPolicyDraft(
        state.spawnPolicyDraft,
        state.spawnPolicies,
        resolveSpawnPolicyOrganizationId({
          ...state,
          selectedAgentId: normalizedAgentId,
        }),
      );

      setState({
        status: "ready",
        detailLoading: false,
        selectedAgentId: normalizedAgentId,
        selectedAgent: isRecord(detailData.agent) ? detailData.agent : null,
        selectedAgentPrincipal: isRecord(detailData.principal) ? detailData.principal : null,
        selectedOrganization: isRecord(detailData.organization) ? detailData.organization : null,
        selectedWorkspacePolicy: workspacePolicy,
        selectedRuntimeProfile: runtimeProfile,
        availableAuthAccounts,
        availableThirdPartyProviders,
        handoffs,
        handoffTimeline,
        workItems,
        mailboxItems,
        selectedWorkItemId,
        spawnPolicyDraft,
        executionBoundaryDraft: syncExecutionBoundaryDraft(
          state.executionBoundaryDraft,
          workspacePolicy,
          runtimeProfile,
        ),
        ...(selectedWorkItemId ? {} : { selectedWorkItemDetail: null }),
      });
      render();

      if (selectedWorkItemId) {
        await loadWorkItemDetail(selectedWorkItemId, {
          preserveNoticeMessage: true,
        });
      }

      return app.runtime.agents;
    } catch (error) {
      if (requestId !== detailRequestId) {
        return app.runtime.agents;
      }

      setState({
        status: "error",
        detailLoading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function loadWorkItemDetail(workItemId, options = {}) {
    const normalizedWorkItemId = normalizeText(workItemId);
    const preserveNoticeMessage = options.preserveNoticeMessage === true;

    if (!normalizedWorkItemId) {
      setState({
        selectedWorkItemId: "",
        selectedWorkItemDetail: null,
        workItemDetailLoading: false,
        humanResponseDraft: createDefaultHumanResponseDraft(),
      });
      render();
      return app.runtime.agents;
    }

    const requestId = ++workItemDetailRequestId;
    setState({
      workItemDetailLoading: true,
      selectedWorkItemId: normalizedWorkItemId,
      errorMessage: "",
      ...(preserveNoticeMessage ? {} : { noticeMessage: "" }),
    });
    render();

    try {
      const data = await postAgents("/api/agents/work-items/detail", {
        ...buildIdentityPayload(app),
        workItemId: normalizedWorkItemId,
      });

      if (requestId !== workItemDetailRequestId) {
        return app.runtime.agents;
      }

      const detail = normalizeWorkItemDetail(data);

      setState({
        workItemDetailLoading: false,
        selectedWorkItemId: normalizedWorkItemId,
        selectedWorkItemDetail: detail,
        humanResponseDraft: syncHumanResponseDraft(app.runtime.agents?.humanResponseDraft, detail),
      });
      render();
      return app.runtime.agents;
    } catch (error) {
      if (requestId !== workItemDetailRequestId) {
        return app.runtime.agents;
      }

      setState({
        status: "error",
        workItemDetailLoading: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function selectAgent(agentId) {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const selectedAgentId = resolveAgentId(agentId, state.agents);
    const dispatchDraft = syncDispatchDraft(state.dispatchDraft, state.agents, selectedAgentId);

    setState({
      selectedAgentId,
      dispatchDraft,
    });
    render();
    return await loadSelectedAgentData(selectedAgentId, {
      preserveNoticeMessage: true,
    });
  }

  async function createAgent() {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const departmentRole = normalizeText(state.createDraft.departmentRole);

    if (!departmentRole) {
      const error = new Error("部门职责不能为空。");
      setState({
        errorMessage: error.message,
        noticeMessage: "",
      });
      render();
      throw error;
    }

    setState({
      creating: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await postAgents("/api/agents/create", {
        ...buildIdentityPayload(app),
        agent: {
          departmentRole,
          ...(normalizeText(state.createDraft.displayName) ? { displayName: state.createDraft.displayName.trim() } : {}),
          ...(normalizeText(state.createDraft.mission) ? { mission: state.createDraft.mission.trim() } : {}),
        },
      });
      const agentId = normalizeText(response?.agent?.agentId) || "";

      setState({
        creating: false,
        noticeMessage: "已创建新的持久化 agent。",
        createDraft: createDefaultCreateDraft(),
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: agentId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        creating: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function approveSpawnSuggestion(suggestionId) {
    const normalizedSuggestionId = normalizeText(suggestionId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const suggestion = state.spawnSuggestions.find((entry) => entry?.suggestionId === normalizedSuggestionId);

    if (!suggestion) {
      const error = new Error("自动创建建议不存在。");
      setState({
        errorMessage: error.message,
        noticeMessage: "",
      });
      render();
      throw error;
    }

    setState({
      approvingSpawnSuggestionId: normalizedSuggestionId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await postAgents("/api/agents/spawn-approve", {
        ...buildIdentityPayload(app),
        agent: {
          departmentRole: suggestion.departmentRole,
          displayName: suggestion.displayName,
          mission: suggestion.mission,
          organizationId: suggestion.organizationId,
          supervisorAgentId: suggestion.suggestedSupervisorAgentId,
        },
      });
      const agentId = normalizeText(response?.agent?.agentId) || "";
      const bootstrapWorkItemId = normalizeText(response?.bootstrapWorkItem?.workItemId) || "";

      setState({
        approvingSpawnSuggestionId: "",
        noticeMessage: `已按建议创建 ${suggestion.displayName || "新"} agent，并进入首次建档。`,
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: agentId,
        selectWorkItemId: bootstrapWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        approvingSpawnSuggestionId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function ignoreSpawnSuggestion(suggestionId) {
    return updateSpawnSuggestionSuppressionState(suggestionId, "ignore");
  }

  async function rejectSpawnSuggestion(suggestionId) {
    return updateSpawnSuggestionSuppressionState(suggestionId, "reject");
  }

  async function restoreSpawnSuggestion(suggestionId) {
    const normalizedSuggestionId = normalizeText(suggestionId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const suggestion = Array.isArray(state.suppressedSpawnSuggestions)
      ? state.suppressedSpawnSuggestions.find((entry) => entry?.suggestionId === normalizedSuggestionId)
      : null;

    if (!suggestion) {
      const error = new Error("自动创建建议不存在。");
      setState({
        errorMessage: error.message,
        noticeMessage: "",
      });
      render();
      throw error;
    }

    setState({
      restoringSpawnSuggestionId: normalizedSuggestionId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/spawn-restore", {
        ...buildIdentityPayload(app),
        suggestion: {
          suggestionId: suggestion.suggestionId,
          organizationId: suggestion.organizationId,
        },
      });

      setState({
        restoringSpawnSuggestionId: "",
        noticeMessage: `已恢复自动创建建议 ${suggestion.displayName || "待命名 agent"}。`,
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: state.selectedAgentId,
        selectWorkItemId: state.selectedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        restoringSpawnSuggestionId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function approveIdleRecoverySuggestion(suggestionId) {
    const normalizedSuggestionId = normalizeText(suggestionId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const suggestion = Array.isArray(state.idleRecoverySuggestions)
      ? state.idleRecoverySuggestions.find((entry) => entry?.suggestionId === normalizedSuggestionId)
      : null;
    const actionLabel = normalizeText(suggestion?.recommendedAction) === "archive" ? "归档" : "暂停";

    if (!suggestion) {
      const error = new Error("空闲回收建议不存在。");
      setState({
        errorMessage: error.message,
        noticeMessage: "",
      });
      render();
      throw error;
    }

    setState({
      approvingIdleRecoverySuggestionId: normalizedSuggestionId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/idle-approve", {
        ...buildIdentityPayload(app),
        suggestion: {
          suggestionId: suggestion.suggestionId,
          organizationId: suggestion.organizationId,
          agentId: suggestion.agentId,
          action: suggestion.recommendedAction,
        },
      });

      setState({
        approvingIdleRecoverySuggestionId: "",
        noticeMessage: `已按建议${actionLabel} ${suggestion.displayName || "该"}。`,
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: normalizeText(state.selectedAgentId) || normalizeText(suggestion.agentId),
        selectWorkItemId: state.selectedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        approvingIdleRecoverySuggestionId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function updateSpawnSuggestionSuppressionState(suggestionId, action) {
    const normalizedSuggestionId = normalizeText(suggestionId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const suggestion = state.spawnSuggestions.find((entry) => entry?.suggestionId === normalizedSuggestionId);
    const actionLabel = action === "ignore" ? "忽略" : "拒绝";

    if (!suggestion) {
      const error = new Error("自动创建建议不存在。");
      setState({
        errorMessage: error.message,
        noticeMessage: "",
      });
      render();
      throw error;
    }

    setState({
      ignoringSpawnSuggestionId: action === "ignore" ? normalizedSuggestionId : "",
      rejectingSpawnSuggestionId: action === "reject" ? normalizedSuggestionId : "",
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents(action === "ignore" ? "/api/agents/spawn-ignore" : "/api/agents/spawn-reject", {
        ...buildIdentityPayload(app),
        suggestion: {
          suggestionId: suggestion.suggestionId,
          organizationId: suggestion.organizationId,
          departmentRole: suggestion.departmentRole,
          displayName: suggestion.displayName,
          mission: suggestion.mission,
          rationale: suggestion.rationale,
          supportingAgentId: suggestion.supportingAgentId,
          supportingAgentDisplayName: suggestion.supportingAgentDisplayName,
          suggestedSupervisorAgentId: suggestion.suggestedSupervisorAgentId,
          openWorkItemCount: suggestion.openWorkItemCount,
          waitingWorkItemCount: suggestion.waitingWorkItemCount,
          highPriorityWorkItemCount: suggestion.highPriorityWorkItemCount,
          spawnPolicy: suggestion.spawnPolicy,
          guardrail: suggestion.guardrail,
          auditFacts: suggestion.auditFacts,
        },
      });

      setState({
        ignoringSpawnSuggestionId: "",
        rejectingSpawnSuggestionId: "",
        noticeMessage: `已${actionLabel}自动创建建议 ${suggestion.displayName || "待命名 agent"}。`,
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: state.selectedAgentId,
        selectWorkItemId: state.selectedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        ignoringSpawnSuggestionId: "",
        rejectingSpawnSuggestionId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function saveSpawnPolicy() {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const draft = syncSpawnPolicyDraft(
      state.spawnPolicyDraft,
      state.spawnPolicies,
      resolveSpawnPolicyOrganizationId(state),
    );

    if (!normalizeText(draft.organizationId)) {
      const error = new Error("当前还没有可配置的组织级自动创建策略。");
      setState({
        errorMessage: error.message,
        noticeMessage: "",
      });
      render();
      throw error;
    }

    if (!Number.isInteger(draft.maxActiveAgents) || draft.maxActiveAgents <= 0) {
      return handleDispatchValidationError("组织活跃 agent 上限必须是正整数。");
    }

    if (!Number.isInteger(draft.maxActiveAgentsPerRole) || draft.maxActiveAgentsPerRole <= 0) {
      return handleDispatchValidationError("同角色活跃 agent 上限必须是正整数。");
    }

    if (draft.maxActiveAgentsPerRole > draft.maxActiveAgents) {
      return handleDispatchValidationError("同角色活跃 agent 上限不能大于组织活跃 agent 上限。");
    }

    setState({
      updatingSpawnPolicy: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await postAgents("/api/agents/spawn-policy/update", {
        ...buildIdentityPayload(app),
        policy: {
          organizationId: draft.organizationId,
          maxActiveAgents: draft.maxActiveAgents,
          maxActiveAgentsPerRole: draft.maxActiveAgentsPerRole,
        },
      });
      const policy = isRecord(response?.policy) ? response.policy : null;

      setState({
        updatingSpawnPolicy: false,
        noticeMessage: "已更新当前组织的自动创建护栏。",
        spawnPolicyDraft: syncSpawnPolicyDraft(
          policy ?? draft,
          policy ? [policy] : state.spawnPolicies,
          normalizeText(draft.organizationId),
        ),
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: state.selectedAgentId,
        selectWorkItemId: state.selectedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        updatingSpawnPolicy: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function saveExecutionBoundary() {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const agentId = normalizeText(state.selectedAgentId);
    const draft = isRecord(state.executionBoundaryDraft)
      ? state.executionBoundaryDraft
      : createDefaultExecutionBoundaryDraft();

    if (!agentId) {
      return handleDispatchValidationError("先选中一个 agent，才能保存执行边界。");
    }

    if (!normalizeText(draft.workspacePath)) {
      return handleDispatchValidationError("默认工作区不能为空。");
    }

    if (draft.accessMode === "auth" && !normalizeText(draft.authAccountId) && state.availableAuthAccounts.length === 0) {
      return handleDispatchValidationError("当前没有可用 auth account。");
    }

    if (
      draft.accessMode === "third-party"
      && !normalizeText(draft.thirdPartyProviderId)
      && state.availableThirdPartyProviders.length === 0
    ) {
      return handleDispatchValidationError("当前没有可用 third-party provider。");
    }

    setState({
      savingExecutionBoundary: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/execution-boundary/update", {
        ...buildIdentityPayload(app),
        agentId,
        boundary: {
          workspacePolicy: {
            workspacePath: draft.workspacePath.trim(),
            additionalDirectories: parseAdditionalDirectoriesText(draft.additionalDirectoriesText),
            allowNetworkAccess: draft.allowNetworkAccess === true,
          },
          runtimeProfile: {
            accessMode: draft.accessMode === "third-party" ? "third-party" : "auth",
            ...(normalizeText(draft.authAccountId) ? { authAccountId: draft.authAccountId.trim() } : {}),
            ...(normalizeText(draft.thirdPartyProviderId)
              ? { thirdPartyProviderId: draft.thirdPartyProviderId.trim() }
              : {}),
            ...(normalizeText(draft.model) ? { model: draft.model.trim() } : {}),
            ...(normalizeText(draft.reasoning) ? { reasoning: draft.reasoning.trim() } : {}),
            ...(normalizeText(draft.memoryMode) ? { memoryMode: draft.memoryMode.trim() } : {}),
            ...(normalizeText(draft.sandboxMode) ? { sandboxMode: draft.sandboxMode.trim() } : {}),
            ...(normalizeText(draft.approvalPolicy) ? { approvalPolicy: draft.approvalPolicy.trim() } : {}),
            ...(normalizeText(draft.webSearchMode) ? { webSearchMode: draft.webSearchMode.trim() } : {}),
            networkAccessEnabled: draft.networkAccessEnabled === true,
          },
        },
      });

      setState({
        savingExecutionBoundary: false,
        noticeMessage: "已更新当前 agent 的默认执行边界。",
      });
      render();

      await loadSelectedAgentData(agentId, {
        preserveNoticeMessage: true,
        selectWorkItemId: state.selectedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        savingExecutionBoundary: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function dispatchWorkItem() {
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const targetAgentId = normalizeText(state.dispatchDraft.targetAgentId);
    const dispatchReason = normalizeText(state.dispatchDraft.dispatchReason);
    const goal = normalizeText(state.dispatchDraft.goal);
    const sourceType = normalizeSourceType(state.dispatchDraft.sourceType);
    const sourceAgentId = sourceType === "agent"
      ? normalizeText(state.dispatchDraft.sourceAgentId)
      : "";
    const parentWorkItemId = resolveDispatchParentWorkItemId(state, sourceType, sourceAgentId, targetAgentId);

    if (!targetAgentId) {
      return handleDispatchValidationError("目标 agent 不能为空。");
    }

    if (!dispatchReason) {
      return handleDispatchValidationError("派工原因不能为空。");
    }

    if (!goal) {
      return handleDispatchValidationError("任务目标不能为空。");
    }

    const targetAgent = resolveAgentById(state.agents, targetAgentId);

    if (targetAgent && normalizeText(targetAgent.status) !== "active") {
      return handleDispatchValidationError("目标 agent 当前不是 active，不能派工。");
    }

    if (sourceType === "agent" && !sourceAgentId) {
      return handleDispatchValidationError("选择 agent 派工时，必须指定来源 agent。");
    }

    let contextPacket;
    try {
      contextPacket = parseContextPacketText(state.dispatchDraft.contextPacketText);
    } catch (error) {
      return handleDispatchValidationError(error instanceof Error ? error.message : String(error));
    }

    setState({
      dispatching: true,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      const response = await postAgents("/api/agents/dispatch", {
        ...buildIdentityPayload(app),
        workItem: {
          targetAgentId,
          sourceType,
          ...(sourceAgentId ? { sourceAgentId } : {}),
          ...(parentWorkItemId ? { parentWorkItemId } : {}),
          dispatchReason,
          goal,
          ...(contextPacket !== undefined ? { contextPacket } : {}),
          priority: normalizePriority(state.dispatchDraft.priority),
        },
      });
      const responseTargetAgentId = normalizeText(response?.targetAgent?.agentId) || targetAgentId;
      const nextSelectedAgentId = parentWorkItemId
        ? normalizeText(state.selectedAgentId) || sourceAgentId || responseTargetAgentId
        : responseTargetAgentId;
      const nextSelectedWorkItemId = parentWorkItemId
        ? parentWorkItemId
        : normalizeText(response?.workItem?.workItemId) || "";

      setState({
        dispatching: false,
        noticeMessage: parentWorkItemId
          ? "已为当前 work item 派出下游子任务。"
          : "已把任务派给目标 agent。",
        dispatchDraft: {
          ...state.dispatchDraft,
          targetAgentId,
          sourceType,
          sourceAgentId: sourceType === "agent" ? sourceAgentId : "",
          dispatchReason: "",
          goal: "",
          contextPacketText: "",
          priority: normalizePriority(state.dispatchDraft.priority),
        },
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: nextSelectedAgentId,
        selectWorkItemId: nextSelectedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        dispatching: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function ackMailboxEntry(mailboxEntryId, agentId) {
    const normalizedMailboxEntryId = normalizeText(mailboxEntryId);
    const normalizedAgentId = normalizeText(agentId);

    if (!normalizedMailboxEntryId || !normalizedAgentId) {
      const error = new Error("Mailbox entry 不完整。");
      setState({
        errorMessage: error.message,
      });
      render();
      throw error;
    }

    setState({
      ackingMailboxEntryId: normalizedMailboxEntryId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/mailbox/ack", {
        ...buildIdentityPayload(app),
        agentId: normalizedAgentId,
        mailboxEntryId: normalizedMailboxEntryId,
      });

      setState({
        ackingMailboxEntryId: "",
        noticeMessage: "已确认该条内部消息。",
      });
      render();

      await loadSelectedAgentData(normalizedAgentId, {
        preserveNoticeMessage: true,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        ackingMailboxEntryId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function respondHumanWaitingWorkItem(workItemId) {
    const normalizedWorkItemId = normalizeText(workItemId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const draft = syncHumanResponseDraft(state.humanResponseDraft, state.selectedWorkItemDetail);

    if (!normalizedWorkItemId) {
      const error = new Error("Work item 不完整。");
      setState({
        errorMessage: error.message,
      });
      render();
      throw error;
    }

    setState({
      respondingWorkItemId: normalizedWorkItemId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/work-items/respond", {
        ...buildIdentityPayload(app),
        workItemId: normalizedWorkItemId,
        response: {
          ...(draft.decision ? { decision: draft.decision } : {}),
          ...(normalizeText(draft.inputText) ? { inputText: draft.inputText.trim() } : {}),
        },
      });

      setState({
        respondingWorkItemId: "",
        noticeMessage: "已提交治理回复，work item 已重新排队。",
        humanResponseDraft: createDefaultHumanResponseDraft(),
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: state.selectedAgentId,
        selectWorkItemId: normalizedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        respondingWorkItemId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function cancelWorkItem(workItemId) {
    const normalizedWorkItemId = normalizeText(workItemId);
    const state = app.runtime.agents ?? createDefaultAgentsState();

    if (!normalizedWorkItemId) {
      const error = new Error("Work item 不完整。");
      setState({
        errorMessage: error.message,
      });
      render();
      throw error;
    }

    setState({
      cancelingWorkItemId: normalizedWorkItemId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/work-items/cancel", {
        ...buildIdentityPayload(app),
        workItemId: normalizedWorkItemId,
      });

      setState({
        cancelingWorkItemId: "",
        noticeMessage: "已取消该条 work item。",
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: state.selectedAgentId,
        selectWorkItemId: normalizedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        cancelingWorkItemId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function respondOrganizationWaitingWorkItem(workItemId) {
    const normalizedWorkItemId = normalizeText(workItemId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const waitingItem = resolveOrganizationWaitingWorkItem(state.organizationWaitingItems, normalizedWorkItemId);
    const draft = syncOrganizationWaitingResponseDraft(
      state.organizationWaitingResponseDrafts?.[normalizedWorkItemId],
      waitingItem,
    );

    if (!waitingItem || normalizeText(waitingItem.workItem?.status) !== "waiting_human") {
      const error = new Error("当前等待项不支持顶层直接治理。");
      setState({
        errorMessage: error.message,
      });
      render();
      throw error;
    }

    setState({
      respondingWorkItemId: normalizedWorkItemId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/work-items/respond", {
        ...buildIdentityPayload(app),
        workItemId: normalizedWorkItemId,
        response: {
          ...(draft.decision ? { decision: draft.decision } : {}),
          ...(normalizeText(draft.inputText) ? { inputText: draft.inputText.trim() } : {}),
        },
      });

      const nextDrafts = {
        ...syncOrganizationWaitingResponseDrafts(
          state.organizationWaitingResponseDrafts,
          state.organizationWaitingItems,
        ),
      };
      delete nextDrafts[normalizedWorkItemId];

      setState({
        respondingWorkItemId: "",
        noticeMessage: "已从组织级等待队列提交治理回复。",
        organizationWaitingResponseDrafts: nextDrafts,
        ...(normalizeText(state.selectedWorkItemId) === normalizedWorkItemId
          ? { humanResponseDraft: createDefaultHumanResponseDraft() }
          : {}),
      });
      render();

      await load({
        preserveNoticeMessage: true,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        respondingWorkItemId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function escalateOrganizationWaitingWorkItem(workItemId) {
    const normalizedWorkItemId = normalizeText(workItemId);
    const state = app.runtime.agents ?? createDefaultAgentsState();
    const waitingItem = resolveOrganizationWaitingWorkItem(state.organizationWaitingItems, normalizedWorkItemId);

    if (!waitingItem || normalizeText(waitingItem.workItem?.status) !== "waiting_agent") {
      const error = new Error("当前等待项不支持升级到顶层治理。");
      setState({
        errorMessage: error.message,
      });
      render();
      throw error;
    }

    setState({
      escalatingWorkItemId: normalizedWorkItemId,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents("/api/agents/work-items/escalate", {
        ...buildIdentityPayload(app),
        workItemId: normalizedWorkItemId,
        escalation: {
          inputText: "由顶层 Themis 接管当前等待中的 agent 阻塞。",
        },
      });

      setState({
        escalatingWorkItemId: "",
        noticeMessage: "已把等待中的 agent 阻塞升级到顶层治理。",
      });
      render();

      await load({
        preserveNoticeMessage: true,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        escalatingWorkItemId: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  async function updateManagedAgentLifecycle(agentId, action) {
    const normalizedAgentId = normalizeText(agentId);
    const lifecycleAction = normalizeLifecycleAction(action);
    const state = app.runtime.agents ?? createDefaultAgentsState();

    if (!normalizedAgentId || !lifecycleAction) {
      const error = new Error("Agent lifecycle 参数不完整。");
      setState({
        errorMessage: error.message,
      });
      render();
      throw error;
    }

    setState({
      lifecycleUpdatingAgentId: normalizedAgentId,
      lifecycleUpdatingAction: lifecycleAction,
      errorMessage: "",
      noticeMessage: "",
    });
    render();

    try {
      await postAgents(`/api/agents/${lifecycleAction}`, {
        ...buildIdentityPayload(app),
        agentId: normalizedAgentId,
      });

      setState({
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        noticeMessage: resolveLifecycleNoticeMessage(lifecycleAction),
      });
      render();

      await load({
        preserveNoticeMessage: true,
        selectAgentId: normalizedAgentId,
        selectWorkItemId: state.selectedWorkItemId,
      });
      return app.runtime.agents;
    } catch (error) {
      setState({
        lifecycleUpdatingAgentId: "",
        lifecycleUpdatingAction: "",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      render();
      throw error;
    }
  }

  function handleDispatchValidationError(message) {
    const error = new Error(message);
    setState({
      errorMessage: error.message,
      noticeMessage: "",
    });
    render();
    throw error;
  }

  return {
    bindControls,
    load,
    createAgent,
    dispatchWorkItem,
    approveSpawnSuggestion,
    approveIdleRecoverySuggestion,
    ignoreSpawnSuggestion,
    rejectSpawnSuggestion,
    restoreSpawnSuggestion,
    selectAgent,
    loadWorkItemDetail,
    ackMailboxEntry,
    saveSpawnPolicy,
    saveExecutionBoundary,
    cancelWorkItem,
    respondHumanWaitingWorkItem,
    respondOrganizationWaitingWorkItem,
    escalateOrganizationWaitingWorkItem,
    pauseManagedAgent: (agentId) => updateManagedAgentLifecycle(agentId, "pause"),
    resumeManagedAgent: (agentId) => updateManagedAgentLifecycle(agentId, "resume"),
    archiveManagedAgent: (agentId) => updateManagedAgentLifecycle(agentId, "archive"),
    updateCreateDraft,
    updateDispatchDraft,
    updateSpawnPolicyDraft,
    updateExecutionBoundaryDraft,
    updateHumanResponseDraft,
    updateOrganizationWaitingResponseDraft,
  };
}

function buildIdentityPayload(app) {
  const browserUserId = normalizeText(app.runtime.identity?.browserUserId) || "browser-local";
  const authEmail = normalizeText(app.runtime.auth?.account?.email);
  const displayName = authEmail || `Themis Web ${browserUserId.slice(-6)}`;

  return {
    channel: "web",
    channelUserId: browserUserId,
    ...(displayName ? { displayName } : {}),
  };
}

async function postAgents(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const data = await safeReadJson(response);

  if (!response.ok) {
    throw new Error(data?.error?.message ?? "读取 agent 状态失败。");
  }

  return data ?? {};
}

function normalizeAgentsCompatibilityStatus(value) {
  if (!isRecord(value)) {
    return null;
  }

  const accessMode = typeof value.accessMode === "string" ? value.accessMode : "local_legacy";
  const statusLevel = value.statusLevel === "error" ? "error" : "warning";
  const message = typeof value.message === "string" ? value.message : "";
  const platformBaseUrl = typeof value.platformBaseUrl === "string" ? value.platformBaseUrl : "";

  if (value.panelOwnership !== "platform") {
    return null;
  }

  return {
    panelOwnership: "platform",
    accessMode: ["platform_gateway", "local_legacy", "invalid_gateway_config"].includes(accessMode)
      ? accessMode
      : "local_legacy",
    statusLevel,
    message: message.trim(),
    platformBaseUrl: platformBaseUrl.trim(),
  };
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function syncDispatchDraft(draft, agents, selectedAgentId) {
  const safeDraft = isRecord(draft) ? draft : createDefaultDispatchDraft();
  const targetAgentId = resolveAgentId(safeDraft.targetAgentId || selectedAgentId, agents);
  const sourceType = normalizeSourceType(safeDraft.sourceType);

  return {
    ...createDefaultDispatchDraft(),
    ...safeDraft,
    targetAgentId,
    sourceType,
    sourceAgentId: sourceType === "agent"
      ? resolveSourceAgentId(safeDraft.sourceAgentId, agents, targetAgentId)
      : "",
    priority: normalizePriority(safeDraft.priority),
  };
}

function normalizeOrganizations(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeAgents(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeWorkItems(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeMailboxItems(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && isRecord(item.entry) && isRecord(item.message))
    : [];
}

function normalizeHandoffs(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.handoffId) && normalizeText(item.summary))
    : [];
}

function normalizeHandoffTimeline(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.entryId) && normalizeText(item.kind))
    : [];
}

function normalizeWaitingSummary(value) {
  return isRecord(value)
    ? {
        totalCount: Number.isFinite(value.totalCount) ? Number(value.totalCount) : 0,
        waitingHumanCount: Number.isFinite(value.waitingHumanCount) ? Number(value.waitingHumanCount) : 0,
        waitingAgentCount: Number.isFinite(value.waitingAgentCount) ? Number(value.waitingAgentCount) : 0,
        escalationCount: Number.isFinite(value.escalationCount) ? Number(value.escalationCount) : 0,
      }
    : {
        totalCount: 0,
        waitingHumanCount: 0,
        waitingAgentCount: 0,
        escalationCount: 0,
      };
}

function normalizeWaitingItems(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && isRecord(item.workItem) && isRecord(item.targetAgent))
    : [];
}

function normalizeGovernanceOverview(value) {
  const overview = isRecord(value) ? value : {};
  const managerHotspots = Array.isArray(overview.managerHotspots)
    ? overview.managerHotspots.filter((item) => isRecord(item) && isRecord(item.managerAgent))
    : [];

  return {
    urgentParentCount: Number.isFinite(overview.urgentParentCount) ? Number(overview.urgentParentCount) : 0,
    attentionParentCount: Number.isFinite(overview.attentionParentCount) ? Number(overview.attentionParentCount) : 0,
    waitingHumanCount: Number.isFinite(overview.waitingHumanCount) ? Number(overview.waitingHumanCount) : 0,
    waitingAgentCount: Number.isFinite(overview.waitingAgentCount) ? Number(overview.waitingAgentCount) : 0,
    staleParentCount: Number.isFinite(overview.staleParentCount) ? Number(overview.staleParentCount) : 0,
    failedChildCount: Number.isFinite(overview.failedChildCount) ? Number(overview.failedChildCount) : 0,
    managersNeedingAttentionCount: Number.isFinite(overview.managersNeedingAttentionCount)
      ? Number(overview.managersNeedingAttentionCount)
      : 0,
    managerHotspots,
  };
}

function normalizeCollaborationDashboardSummary(value) {
  return isRecord(value)
    ? {
        totalCount: Number.isFinite(value.totalCount) ? Number(value.totalCount) : 0,
        urgentCount: Number.isFinite(value.urgentCount) ? Number(value.urgentCount) : 0,
        attentionCount: Number.isFinite(value.attentionCount) ? Number(value.attentionCount) : 0,
        normalCount: Number.isFinite(value.normalCount) ? Number(value.normalCount) : 0,
      }
    : {
        totalCount: 0,
        urgentCount: 0,
        attentionCount: 0,
        normalCount: 0,
      };
}

function normalizeCollaborationDashboardItems(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && isRecord(item.parentWorkItem) && isRecord(item.managerAgent))
    : [];
}

function normalizeSpawnPolicies(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.organizationId))
    : [];
}

function normalizeSpawnSuggestions(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.suggestionId) && normalizeText(item.departmentRole))
    : [];
}

function normalizeSpawnAuditLogs(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.auditLogId) && normalizeText(item.eventType))
    : [];
}

function normalizeIdleRecoverySuggestions(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.suggestionId) && normalizeText(item.agentId))
    : [];
}

function normalizeIdleRecoveryAuditLogs(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.auditLogId) && normalizeText(item.eventType))
    : [];
}

function normalizeSuppressedSpawnSuggestions(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.suggestionId) && normalizeText(item.suppressionState))
    : [];
}

function normalizeAuthAccounts(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.accountId))
    : [];
}

function normalizeThirdPartyProviders(value) {
  return Array.isArray(value)
    ? value.filter((item) => isRecord(item) && normalizeText(item.id))
    : [];
}

function normalizeExecutionWorkspacePolicy(value) {
  return isRecord(value) && normalizeText(value.workspacePath) ? value : null;
}

function normalizeExecutionRuntimeProfile(value) {
  return isRecord(value) && normalizeText(value.profileId || "runtime-profile") ? value : null;
}

function normalizeWorkItemDetail(value) {
  return isRecord(value) ? value : null;
}

function createEmptyCollaborationDashboardResponse() {
  return {
    summary: {
      totalCount: 0,
      urgentCount: 0,
      attentionCount: 0,
      normalCount: 0,
    },
    items: [],
  };
}

function createEmptyGovernanceOverviewResponse() {
  return {
    overview: normalizeGovernanceOverview(null),
  };
}

function normalizeGovernanceAttentionLevel(value) {
  return ["all", "normal", "attention", "urgent"].includes(normalizeText(value))
    ? normalizeText(value)
    : "all";
}

function normalizeGovernanceWaitingFor(value) {
  return ["any", "human", "agent"].includes(normalizeText(value))
    ? normalizeText(value)
    : "any";
}

function syncGovernanceFilters(value, organizations, agents) {
  const safeValue = isRecord(value) ? value : createDefaultGovernanceFilters();
  const organizationId = normalizeText(safeValue.organizationId) || normalizeText(organizations?.[0]?.organizationId);
  const filteredAgents = Array.isArray(agents)
    ? agents.filter((agent) => !organizationId || normalizeText(agent?.organizationId) === organizationId)
    : [];
  const managerAgentId = resolveGovernanceManagerAgentId(safeValue.managerAgentId, filteredAgents);
  const limit = Number.isFinite(safeValue.limit) && Number(safeValue.limit) > 0
    ? Math.floor(Number(safeValue.limit))
    : 20;

  return {
    organizationId,
    managerAgentId,
    attentionLevel: normalizeGovernanceAttentionLevel(safeValue.attentionLevel),
    waitingFor: normalizeGovernanceWaitingFor(safeValue.waitingFor),
    staleOnly: safeValue.staleOnly === true,
    failedOnly: safeValue.failedOnly === true,
    limit,
  };
}

function resolveGovernanceManagerAgentId(candidateId, agents) {
  const normalizedCandidateId = normalizeText(candidateId);

  if (!normalizedCandidateId) {
    return "";
  }

  return Array.isArray(agents) && agents.some((agent) => normalizeText(agent?.agentId) === normalizedCandidateId)
    ? normalizedCandidateId
    : "";
}

function buildGovernanceFiltersPayload(filters) {
  const safeFilters = isRecord(filters)
    ? {
        organizationId: normalizeText(filters.organizationId),
        managerAgentId: normalizeText(filters.managerAgentId),
        attentionLevel: normalizeGovernanceAttentionLevel(filters.attentionLevel),
        waitingFor: normalizeGovernanceWaitingFor(filters.waitingFor),
        staleOnly: filters.staleOnly === true,
        failedOnly: filters.failedOnly === true,
        limit: Number.isFinite(filters.limit) && Number(filters.limit) > 0 ? Math.floor(Number(filters.limit)) : 20,
      }
    : createDefaultGovernanceFilters();
  const payload = {
    ...(safeFilters.organizationId ? { organizationId: safeFilters.organizationId } : {}),
    ...(safeFilters.managerAgentId ? { managerAgentId: safeFilters.managerAgentId } : {}),
    ...(safeFilters.attentionLevel !== "all" ? { attentionLevels: [safeFilters.attentionLevel] } : {}),
    ...(safeFilters.waitingFor !== "any" ? { waitingFor: safeFilters.waitingFor } : {}),
    ...(safeFilters.staleOnly ? { staleOnly: true } : {}),
    ...(safeFilters.failedOnly ? { failedOnly: true } : {}),
    ...(safeFilters.limit ? { limit: safeFilters.limit } : {}),
  };

  return payload;
}

function resolveAgentId(candidateId, agents) {
  const normalizedCandidateId = normalizeText(candidateId);

  if (normalizedCandidateId && agents.some((agent) => normalizeText(agent.agentId) === normalizedCandidateId)) {
    return normalizedCandidateId;
  }

  return normalizeText(agents[0]?.agentId) || "";
}

function resolveAgentById(agents, agentId) {
  const normalizedAgentId = normalizeText(agentId);

  if (!normalizedAgentId || !Array.isArray(agents)) {
    return null;
  }

  return agents.find((agent) => normalizeText(agent?.agentId) === normalizedAgentId) ?? null;
}

function resolveSpawnPolicyOrganizationId(state) {
  const selectedAgent = resolveAgentById(state?.agents, state?.selectedAgentId);
  return normalizeText(selectedAgent?.organizationId)
    || normalizeText(state?.selectedOrganization?.organizationId)
    || normalizeText(state?.spawnPolicyDraft?.organizationId)
    || normalizeText(state?.organizations?.[0]?.organizationId)
    || normalizeText(state?.spawnPolicies?.[0]?.organizationId)
    || "";
}

function resolveSourceAgentId(candidateId, agents, targetAgentId) {
  const normalizedCandidateId = normalizeText(candidateId);

  if (normalizedCandidateId && agents.some((agent) => normalizeText(agent.agentId) === normalizedCandidateId)) {
    return normalizedCandidateId;
  }

  const firstAlternative = agents.find((agent) => normalizeText(agent.agentId) !== normalizeText(targetAgentId));
  return normalizeText(firstAlternative?.agentId) || normalizeText(agents[0]?.agentId) || "";
}

function resolveDispatchParentWorkItemId(state, sourceType, sourceAgentId, targetAgentId) {
  if (sourceType !== "agent") {
    return "";
  }

  const selectedWorkItem = isRecord(state?.selectedWorkItemDetail?.workItem)
    ? state.selectedWorkItemDetail.workItem
    : null;
  const selectedWorkItemId = normalizeText(selectedWorkItem?.workItemId);
  const selectedTargetAgentId = normalizeText(selectedWorkItem?.targetAgentId);

  if (!selectedWorkItemId || !selectedTargetAgentId) {
    return "";
  }

  if (selectedTargetAgentId !== normalizeText(sourceAgentId)) {
    return "";
  }

  if (normalizeText(targetAgentId) === selectedTargetAgentId) {
    return "";
  }

  return selectedWorkItemId;
}

function resolveWorkItemId(candidateId, workItems) {
  const normalizedCandidateId = normalizeText(candidateId);

  if (normalizedCandidateId && workItems.some((item) => normalizeText(item.workItemId) === normalizedCandidateId)) {
    return normalizedCandidateId;
  }

  return normalizeText(workItems[0]?.workItemId) || "";
}

function syncSpawnPolicyDraft(currentDraft, spawnPolicies, organizationId) {
  const normalizedOrganizationId = normalizeText(organizationId);
  const matchingPolicy = Array.isArray(spawnPolicies)
    ? spawnPolicies.find((policy) => normalizeText(policy?.organizationId) === normalizedOrganizationId)
      ?? spawnPolicies[0]
    : null;
  const baseDraft = isRecord(currentDraft) ? currentDraft : createDefaultSpawnPolicyDraft();

  if (!matchingPolicy) {
    return createDefaultSpawnPolicyDraft();
  }

  return {
    organizationId: normalizeText(matchingPolicy.organizationId) || normalizedOrganizationId || "",
    maxActiveAgents: Number.isFinite(baseDraft.maxActiveAgents)
      && normalizeText(baseDraft.organizationId) === normalizeText(matchingPolicy.organizationId)
      ? Number(baseDraft.maxActiveAgents)
      : normalizePositiveIntegerInput(matchingPolicy.maxActiveAgents, 12),
    maxActiveAgentsPerRole: Number.isFinite(baseDraft.maxActiveAgentsPerRole)
      && normalizeText(baseDraft.organizationId) === normalizeText(matchingPolicy.organizationId)
      ? Number(baseDraft.maxActiveAgentsPerRole)
      : normalizePositiveIntegerInput(matchingPolicy.maxActiveAgentsPerRole, 3),
  };
}

function syncExecutionBoundaryDraft(currentDraft, workspacePolicy, runtimeProfile) {
  const baseDraft = isRecord(currentDraft) ? currentDraft : createDefaultExecutionBoundaryDraft();

  return {
    ...createDefaultExecutionBoundaryDraft(),
    ...baseDraft,
    workspacePath: normalizeText(workspacePolicy?.workspacePath) || "",
    additionalDirectoriesText: Array.isArray(workspacePolicy?.additionalDirectories)
      ? workspacePolicy.additionalDirectories
        .filter((entry) => typeof entry === "string")
        .join("\n")
      : "",
    allowNetworkAccess: workspacePolicy?.allowNetworkAccess !== false,
    accessMode: normalizeText(runtimeProfile?.accessMode) === "third-party" ? "third-party" : "auth",
    authAccountId: normalizeText(runtimeProfile?.authAccountId) || "",
    thirdPartyProviderId: normalizeText(runtimeProfile?.thirdPartyProviderId) || "",
    model: normalizeText(runtimeProfile?.model) || "",
    reasoning: normalizeText(runtimeProfile?.reasoning) || "",
    memoryMode: normalizeText(runtimeProfile?.memoryMode) || "",
    sandboxMode: normalizeText(runtimeProfile?.sandboxMode) || "workspace-write",
    approvalPolicy: normalizeText(runtimeProfile?.approvalPolicy) || "never",
    webSearchMode: normalizeText(runtimeProfile?.webSearchMode) || "live",
    networkAccessEnabled: runtimeProfile?.networkAccessEnabled !== false,
  };
}

function normalizePriority(value) {
  const normalized = normalizeText(value);
  return PRIORITIES.includes(normalized) ? normalized : "normal";
}

function normalizeLifecycleAction(value) {
  const normalized = normalizeText(value);
  return ["pause", "resume", "archive"].includes(normalized) ? normalized : "";
}

function normalizeSourceType(value) {
  const normalized = normalizeText(value);
  return SOURCE_TYPES.includes(normalized) ? normalized : "human";
}

function normalizeHumanDecision(value) {
  const normalized = normalizeText(value);
  return ["approve", "deny"].includes(normalized) ? normalized : "";
}

function syncHumanResponseDraft(draft, detail) {
  const safeDraft = isRecord(draft) ? draft : createDefaultHumanResponseDraft();
  const workItemId = normalizeText(detail?.workItem?.workItemId);
  const status = normalizeText(detail?.workItem?.status);

  if (!workItemId || status !== "waiting_human") {
    return createDefaultHumanResponseDraft();
  }

  if (normalizeText(safeDraft.workItemId) === workItemId) {
    return {
      ...createDefaultHumanResponseDraft(),
      ...safeDraft,
      workItemId,
      decision: normalizeHumanDecision(safeDraft.decision),
    };
  }

  return {
    ...createDefaultHumanResponseDraft(),
    workItemId,
  };
}

function syncOrganizationWaitingResponseDraft(draft, waitingItem) {
  const workItemId = normalizeText(waitingItem?.workItem?.workItemId);
  const status = normalizeText(waitingItem?.workItem?.status);
  const safeDraft = isRecord(draft) ? draft : createDefaultOrganizationWaitingResponseDraft();

  if (!workItemId || status !== "waiting_human") {
    return createDefaultOrganizationWaitingResponseDraft();
  }

  return {
    decision: normalizeHumanDecision(safeDraft.decision),
    inputText: typeof safeDraft.inputText === "string" ? safeDraft.inputText : "",
  };
}

function syncOrganizationWaitingResponseDrafts(drafts, waitingItems) {
  const safeDrafts = isRecord(drafts) ? drafts : {};
  const nextDrafts = {};

  for (const item of Array.isArray(waitingItems) ? waitingItems : []) {
    const workItemId = normalizeText(item?.workItem?.workItemId);
    const status = normalizeText(item?.workItem?.status);

    if (!workItemId || status !== "waiting_human") {
      continue;
    }

    nextDrafts[workItemId] = syncOrganizationWaitingResponseDraft(safeDrafts[workItemId], item);
  }

  return nextDrafts;
}

function resolveOrganizationWaitingWorkItem(waitingItems, workItemId) {
  const normalizedWorkItemId = normalizeText(workItemId);

  if (!normalizedWorkItemId) {
    return null;
  }

  return Array.isArray(waitingItems)
    ? waitingItems.find((item) => normalizeText(item?.workItem?.workItemId) === normalizedWorkItemId) ?? null
    : null;
}

function resolveLifecycleNoticeMessage(action) {
  switch (action) {
    case "pause":
      return "已暂停该 agent。";
    case "resume":
      return "已恢复该 agent。";
    case "archive":
      return "已归档该 agent。";
    default:
      return "已更新 agent 状态。";
  }
}

function parseContextPacketText(value) {
  const normalized = typeof value === "string" ? value.trim() : "";

  if (!normalized) {
    return undefined;
  }

  if (normalized.startsWith("{") || normalized.startsWith("[")) {
    try {
      return JSON.parse(normalized);
    } catch {
      throw new Error("上下文包必须是合法 JSON，或直接留空。");
    }
  }

  return normalized;
}

function parseAdditionalDirectoriesText(value) {
  if (typeof value !== "string") {
    return [];
  }

  return [...new Set(
    value
      .split(/\r?\n/g)
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )];
}

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizePositiveIntegerInput(value, fallback) {
  const asNumber = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : NaN;

  return Number.isInteger(asNumber) && asNumber > 0 ? asNumber : fallback;
}

function isRecord(value) {
  return typeof value === "object" && value !== null;
}
