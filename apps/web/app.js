import { LAYOUT_STORAGE_KEY, MAX_THREAD_COUNT, STORAGE_KEY, WEB_IDENTITY_STORAGE_KEY } from "./modules/constants.js";
import { createActions } from "./modules/actions.js";
import { createAgentsController, createDefaultAgentsState } from "./modules/agents.js";
import { createAuthController, createDefaultAuthState } from "./modules/auth.js";
import { createDom } from "./modules/dom.js";
import { createHistoryController } from "./modules/history.js";
import { createIdentityController } from "./modules/identity.js";
import { createInputAssetsApi } from "./modules/input-assets.js";
import { createLayoutController } from "./modules/layout.js";
import { createDefaultMemoryCandidatesState, createMemoryCandidatesController } from "./modules/memory-candidates.js";
import { createDefaultMcpState, createMcpController } from "./modules/mcp.js";
import { createDefaultModeSwitchDraftState, createModeSwitchController } from "./modules/mode-switch.js";
import { createDefaultPluginsState, createPluginsController } from "./modules/plugins.js";
import { createDefaultRuntimeConfigState, createRuntimeConfigController } from "./modules/runtime-config.js";
import { createSessionSettingsController } from "./modules/session-settings.js";
import { createDefaultSkillsState, createSkillsController } from "./modules/skills.js";
import { createStore } from "./modules/store.js";
import { createDefaultUpdateManagerState, createUpdateManagerController } from "./modules/update-manager.js";
import {
  createDefaultThirdPartyEndpointProbeState,
  createThirdPartyEndpointProbeController,
} from "./modules/third-party-endpoint-probe.js";
import { createDefaultThirdPartyEditorState, createThirdPartyEditorController } from "./modules/third-party-editor.js";
import { createDefaultThirdPartyProbeState, createThirdPartyProbeController } from "./modules/third-party-probe.js";
import { createRenderer } from "./modules/ui.js";
import * as utils from "./modules/utils.js";

const app = {
  constants: {
    STORAGE_KEY,
    LAYOUT_STORAGE_KEY,
    WEB_IDENTITY_STORAGE_KEY,
    MAX_THREAD_COUNT,
  },
  dom: createDom(),
  utils,
  runtime: {
    activeRequestController: null,
    activeRunRef: null,
    pendingInterruptSubmit: null,
    sessionControlBusy: false,
    historySyncBusy: false,
    historyHydratingThreadId: null,
    threadSearchQuery: "",
    historyIncludeArchived: false,
    historyServerFilterActive: false,
    historyServerFilterSessionIds: null,
    historyServerFilterQuery: "",
    historyServerFilterIncludeArchived: false,
    threadControlJoinOpen: false,
    authBusy: false,
    auth: createDefaultAuthState(),
    identity: null,
    workspaceToolsOpen: false,
    workspaceToolsSection: "runtime",
    agents: createDefaultAgentsState(),
    memoryCandidates: createDefaultMemoryCandidatesState(),
    mcp: createDefaultMcpState(),
    plugins: createDefaultPluginsState(),
    skills: createDefaultSkillsState(),
    runtimeConfig: createDefaultRuntimeConfigState(),
    updateManager: createDefaultUpdateManagerState(),
    modeSwitchDraft: createDefaultModeSwitchDraftState(),
    thirdPartyEditor: createDefaultThirdPartyEditorState(),
    thirdPartyEndpointProbe: createDefaultThirdPartyEndpointProbeState(),
    thirdPartyProbe: createDefaultThirdPartyProbeState(),
  },
};

app.store = createStore(app);
app.renderer = createRenderer(app);
app.inputAssets = createInputAssetsApi();
app.history = createHistoryController(app);
app.layout = createLayoutController(app);
app.auth = createAuthController(app);
app.identity = createIdentityController(app);
app.agents = createAgentsController(app);
app.memoryCandidates = createMemoryCandidatesController(app);
app.mcp = createMcpController(app);
app.plugins = createPluginsController(app);
app.runtimeConfig = createRuntimeConfigController(app);
app.updateManager = createUpdateManagerController(app);
app.sessionSettings = createSessionSettingsController(app);
app.skills = createSkillsController(app);
app.mcp.bindControls();
app.plugins.bindControls();
app.skills.bindControls();
app.agents.bindControls();
app.memoryCandidates.bindControls();
app.modeSwitch = createModeSwitchController(app);
app.thirdPartyEditor = createThirdPartyEditorController(app);
app.thirdPartyEndpointProbe = createThirdPartyEndpointProbeController(app);
app.thirdPartyProbe = createThirdPartyProbeController(app);
app.actions = createActions(app);

app.layout.initialize();
app.actions.initialize();
