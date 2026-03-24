function createDefaultProviderForm() {
  return {
    id: "",
    name: "",
    baseUrl: "",
    apiKey: "",
    wireApi: "responses",
    supportsWebsockets: false,
  };
}

function createDefaultModelForm(providerId = "") {
  return {
    providerId,
    model: "",
    displayName: "",
    description: "",
    defaultReasoningLevel: "medium",
    contextWindow: "",
    supportsCodexTasks: true,
    imageInput: false,
    setAsDefault: true,
  };
}

export function createDefaultThirdPartyEditorState() {
  return {
    open: false,
    mode: "",
    submitting: false,
    errorMessage: "",
    providerForm: createDefaultProviderForm(),
    modelForm: createDefaultModelForm(),
  };
}

export function createThirdPartyEditorController(app) {
  const { dom, store } = app;

  function bindControls() {
    dom.thirdPartyAddProviderButton.addEventListener("click", () => {
      openProviderDialog();
    });

    dom.thirdPartyAddModelButton.addEventListener("click", () => {
      openModelDialog();
    });

    dom.thirdPartyEditorBackdrop.addEventListener("click", () => {
      close();
    });

    dom.thirdPartyEditorClose.addEventListener("click", () => {
      close();
    });

    dom.thirdPartyProviderCancelButton.addEventListener("click", () => {
      close();
    });

    dom.thirdPartyModelCancelButton.addEventListener("click", () => {
      close();
    });

    dom.thirdPartyProviderForm.addEventListener("input", handleProviderFormChange);
    dom.thirdPartyProviderForm.addEventListener("change", handleProviderFormChange);
    dom.thirdPartyModelForm.addEventListener("input", handleModelFormChange);
    dom.thirdPartyModelForm.addEventListener("change", handleModelFormChange);

    dom.thirdPartyProviderForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitProvider();
    });

    dom.thirdPartyModelForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void submitModel();
    });
  }

  function openProviderDialog() {
    app.runtime.thirdPartyEditor = {
      ...createDefaultThirdPartyEditorState(),
      open: true,
      mode: "provider",
      modelForm: createDefaultModelForm(resolveCurrentProviderId()),
    };
    app.renderer.renderAll();
  }

  function openModelDialog() {
    const providers = store.getThirdPartyProviders();

    if (!providers.length) {
      return;
    }

    app.runtime.thirdPartyEditor = {
      ...createDefaultThirdPartyEditorState(),
      open: true,
      mode: "model",
      modelForm: createDefaultModelForm(resolveCurrentProviderId()),
    };
    app.renderer.renderAll();
  }

  function close(shouldRender = true, force = false) {
    if (app.runtime.thirdPartyEditor.submitting && !force) {
      return;
    }

    app.runtime.thirdPartyEditor = createDefaultThirdPartyEditorState();

    if (shouldRender) {
      app.renderer.renderAll();
    }
  }

  function handleProviderFormChange(event) {
    const target = event.target;

    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      return;
    }

    updateProviderFormField(target.name, target.type === "checkbox" ? target.checked : target.value);
  }

  function handleModelFormChange(event) {
    const target = event.target;

    if (!(target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement)) {
      return;
    }

    updateModelFormField(target.name, target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value);
  }

  function updateProviderFormField(field, value) {
    const current = app.runtime.thirdPartyEditor;
    app.runtime.thirdPartyEditor = {
      ...current,
      errorMessage: "",
      providerForm: {
        ...current.providerForm,
        [field]: value,
      },
    };
    app.renderer.renderAll();
  }

  function updateModelFormField(field, value) {
    const current = app.runtime.thirdPartyEditor;
    app.runtime.thirdPartyEditor = {
      ...current,
      errorMessage: "",
      modelForm: {
        ...current.modelForm,
        [field]: value,
      },
    };
    app.renderer.renderAll();
  }

  async function submitProvider() {
    const state = app.runtime.thirdPartyEditor;

    if (state.submitting) {
      return;
    }

    app.runtime.thirdPartyEditor = {
      ...state,
      submitting: true,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/runtime/third-party/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(state.providerForm),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存第三方供应商失败。");
      }

      await app.runtimeConfig.load(true);
      applyThirdPartySelection(data?.providerId, "");
      close(false, true);
      app.renderer.renderAll();
    } catch (error) {
      app.runtime.thirdPartyEditor = {
        ...app.runtime.thirdPartyEditor,
        submitting: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      app.renderer.renderAll();
    }
  }

  async function submitModel() {
    const state = app.runtime.thirdPartyEditor;

    if (state.submitting) {
      return;
    }

    app.runtime.thirdPartyEditor = {
      ...state,
      submitting: true,
      errorMessage: "",
    };
    app.renderer.renderAll();

    try {
      const response = await fetch("/api/runtime/third-party/models", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...state.modelForm,
          contextWindow: state.modelForm.contextWindow ? Number.parseInt(state.modelForm.contextWindow, 10) : null,
        }),
      });
      const data = await app.utils.safeReadJson(response);

      if (!response.ok) {
        throw new Error(data?.error?.message ?? "保存第三方模型失败。");
      }

      await app.runtimeConfig.load(true);
      applyThirdPartySelection(state.modelForm.providerId, state.modelForm.model);
      close(false, true);
      app.renderer.renderAll();
    } catch (error) {
      app.runtime.thirdPartyEditor = {
        ...app.runtime.thirdPartyEditor,
        submitting: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      app.renderer.renderAll();
    }
  }

  function applyThirdPartySelection(providerId, model) {
    const thread = store.getActiveThread();

    if (!thread) {
      app.thirdPartyProbe.clear();
      return;
    }

    store.updateThreadSettings({
      thirdPartyProviderId: providerId || "",
      thirdPartyModel: model || "",
    });
    app.thirdPartyProbe.clearIfSelectionChanged(providerId || "", model || "");
  }

  function resolveCurrentProviderId() {
    const settings = store.getActiveThread()?.settings ?? store.createDefaultThreadSettings();
    return store.resolveThirdPartySelection(settings).provider?.id || store.getThirdPartyProviders()[0]?.id || "";
  }

  return {
    bindControls,
    close,
    openProviderDialog,
    openModelDialog,
  };
}
