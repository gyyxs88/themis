import { LAYOUT_STORAGE_KEY, MAX_THREAD_COUNT, STORAGE_KEY, WEB_IDENTITY_STORAGE_KEY } from "./modules/constants.js";
import { createActions } from "./modules/actions.js";
import { createAuthController, createDefaultAuthState } from "./modules/auth.js";
import { createDom } from "./modules/dom.js";
import { createHistoryController } from "./modules/history.js";
import { createIdentityController } from "./modules/identity.js";
import { createLayoutController } from "./modules/layout.js";
import { createDefaultModeSwitchDraftState, createModeSwitchController } from "./modules/mode-switch.js";
import { createDefaultRuntimeConfigState, createRuntimeConfigController } from "./modules/runtime-config.js";
import { createSessionSettingsController } from "./modules/session-settings.js";
import { createStore } from "./modules/store.js";
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
    authBusy: false,
    auth: createDefaultAuthState(),
    identity: null,
    workspaceToolsOpen: false,
    workspaceToolsSection: "runtime",
    runtimeConfig: createDefaultRuntimeConfigState(),
    modeSwitchDraft: createDefaultModeSwitchDraftState(),
    thirdPartyEditor: createDefaultThirdPartyEditorState(),
    thirdPartyProbe: createDefaultThirdPartyProbeState(),
  },
};

app.store = createStore(app);
app.renderer = createRenderer(app);
app.history = createHistoryController(app);
app.layout = createLayoutController(app);
app.auth = createAuthController(app);
app.identity = createIdentityController(app);
app.runtimeConfig = createRuntimeConfigController(app);
app.sessionSettings = createSessionSettingsController(app);
app.modeSwitch = createModeSwitchController(app);
app.thirdPartyEditor = createThirdPartyEditorController(app);
app.thirdPartyProbe = createThirdPartyProbeController(app);
app.actions = createActions(app);

app.layout.initialize();
app.actions.initialize();
