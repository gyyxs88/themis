import {
  DEFAULT_ROLE,
  DEFAULT_WORKFLOW,
  LAYOUT_STORAGE_KEY,
  MAX_THREAD_COUNT,
  STORAGE_KEY,
} from "./modules/constants.js";
import { createActions } from "./modules/actions.js";
import { createDom } from "./modules/dom.js";
import { createHistoryController } from "./modules/history.js";
import { createLayoutController } from "./modules/layout.js";
import { createStore } from "./modules/store.js";
import { createRenderer } from "./modules/ui.js";
import * as utils from "./modules/utils.js";

const app = {
  constants: {
    STORAGE_KEY,
    LAYOUT_STORAGE_KEY,
    MAX_THREAD_COUNT,
    DEFAULT_WORKFLOW,
    DEFAULT_ROLE,
  },
  dom: createDom(),
  utils,
  runtime: {
    activeRequestController: null,
    activeRunRef: null,
    sessionControlBusy: false,
    historySyncBusy: false,
    historyHydratingThreadId: null,
    historyLastSyncedAt: null,
    historySyncError: null,
    threadSearchQuery: "",
    workspaceToolsOpen: false,
  },
};

app.store = createStore(app);
app.renderer = createRenderer(app);
app.history = createHistoryController(app);
app.layout = createLayoutController(app);
app.actions = createActions(app);

app.layout.initialize();
app.actions.initialize();
