import { LAYOUT_STORAGE_KEY } from "./constants.js";

const MOBILE_BREAKPOINT = "(max-width: 920px)";
const DEFAULT_SIDEBAR_WIDTH = 272;
const MIN_SIDEBAR_WIDTH = 232;
const MAX_SIDEBAR_WIDTH = 420;
const DEFAULT_WIDTH_STEP = 16;

export function createLayoutController(app) {
  const { dom } = app;
  const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT);

  let state = loadLayoutState();
  let dragState = null;
  let initialized = false;

  function initialize() {
    if (initialized) {
      return;
    }

    initialized = true;
    bindEvents();
    applyLayout();
  }

  function bindEvents() {
    dom.sidebarCollapseButton.addEventListener("click", () => {
      if (isMobileViewport()) {
        closeMobileSidebar();
        return;
      }

      setDesktopCollapsed(true);
    });

    dom.workspaceSidebarToggle.addEventListener("click", () => {
      if (isMobileViewport()) {
        state.mobileOpen = !state.mobileOpen;
        persistLayoutState();
        applyLayout();
        return;
      }

      setDesktopCollapsed(!state.desktopCollapsed);
    });

    dom.sidebarBackdrop.addEventListener("click", () => {
      closeMobileSidebar();
    });

    dom.sidebarResizeHandle.addEventListener("pointerdown", handleResizeStart);
    dom.sidebarResizeHandle.addEventListener("keydown", handleResizeKeydown);
    dom.sidebarResizeHandle.addEventListener("dblclick", resetSidebarWidth);
    window.addEventListener("pointermove", handleResizeMove);
    window.addEventListener("pointerup", handleResizeEnd);
    window.addEventListener("pointercancel", handleResizeEnd);
    window.addEventListener("keydown", handleGlobalKeydown);
    window.addEventListener("resize", handleViewportChange);
    mediaQuery.addEventListener("change", handleViewportChange);
  }

  function handleViewportChange() {
    if (!isMobileViewport()) {
      state.mobileOpen = false;
    }

    state.sidebarWidth = clampSidebarWidth(state.sidebarWidth);
    persistLayoutState();
    applyLayout();
  }

  function handleGlobalKeydown(event) {
    if (event.key === "Escape" && isMobileViewport() && state.mobileOpen) {
      closeMobileSidebar();
      dom.workspaceSidebarToggle.focus();
    }
  }

  function handleResizeStart(event) {
    if (isMobileViewport() || state.desktopCollapsed) {
      return;
    }

    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: state.sidebarWidth,
    };

    dom.sidebarResizeHandle.setPointerCapture?.(event.pointerId);
    dom.appShell.dataset.sidebarResizing = "true";
    document.body.classList.add("sidebar-resizing");
  }

  function handleResizeMove(event) {
    if (!dragState) {
      return;
    }

    const nextWidth = clampSidebarWidth(dragState.startWidth + (event.clientX - dragState.startX));

    if (nextWidth === state.sidebarWidth) {
      return;
    }

    state.sidebarWidth = nextWidth;
    dom.appShell.style.setProperty("--sidebar-inline-size", `${nextWidth}px`);
    updateResizeA11y();
  }

  function handleResizeEnd(event) {
    if (!dragState) {
      return;
    }

    dom.sidebarResizeHandle.releasePointerCapture?.(dragState.pointerId);
    dragState = null;
    dom.appShell.dataset.sidebarResizing = "false";
    document.body.classList.remove("sidebar-resizing");
    persistLayoutState();
    applyLayout();
  }

  function handleResizeKeydown(event) {
    if (isMobileViewport() || state.desktopCollapsed) {
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      state.sidebarWidth = clampSidebarWidth(state.sidebarWidth - DEFAULT_WIDTH_STEP);
      persistLayoutState();
      applyLayout();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      state.sidebarWidth = clampSidebarWidth(state.sidebarWidth + DEFAULT_WIDTH_STEP);
      persistLayoutState();
      applyLayout();
    }
  }

  function resetSidebarWidth() {
    if (isMobileViewport() || state.desktopCollapsed) {
      return;
    }

    state.sidebarWidth = clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH);
    persistLayoutState();
    applyLayout();
  }

  function loadLayoutState() {
    try {
      const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;

      return {
        desktopCollapsed: Boolean(parsed?.desktopCollapsed),
        mobileOpen: false,
        sidebarWidth: clampSidebarWidth(
          Number.isFinite(parsed?.sidebarWidth) ? Number(parsed.sidebarWidth) : DEFAULT_SIDEBAR_WIDTH,
        ),
      };
    } catch {
      return {
        desktopCollapsed: false,
        mobileOpen: false,
        sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
      };
    }
  }

  function persistLayoutState() {
    localStorage.setItem(
      LAYOUT_STORAGE_KEY,
      JSON.stringify({
        desktopCollapsed: state.desktopCollapsed,
        sidebarWidth: state.sidebarWidth,
      }),
    );
  }

  function isMobileViewport() {
    return mediaQuery.matches;
  }

  function clampSidebarWidth(width) {
    const safeViewportMax = Math.max(MIN_SIDEBAR_WIDTH, Math.floor(window.innerWidth - 360));
    const maxWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, safeViewportMax));
    const nextWidth = Number.isFinite(width) ? Math.round(width) : DEFAULT_SIDEBAR_WIDTH;
    return Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxWidth, nextWidth));
  }

  function updateResizeA11y() {
    dom.sidebarResizeHandle.setAttribute("aria-valuenow", String(state.sidebarWidth));
    dom.sidebarResizeHandle.setAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH));
    dom.sidebarResizeHandle.setAttribute("aria-valuemax", String(clampSidebarWidth(MAX_SIDEBAR_WIDTH)));
  }

  function applyLayout() {
    const mobile = isMobileViewport();
    const desktopCollapsed = !mobile && state.desktopCollapsed;
    const mobileOpen = mobile && state.mobileOpen;

    state.sidebarWidth = clampSidebarWidth(state.sidebarWidth);
    dom.appShell.style.setProperty("--sidebar-inline-size", `${state.sidebarWidth}px`);
    dom.appShell.dataset.mobileViewport = String(mobile);
    dom.appShell.dataset.sidebarCollapsed = String(desktopCollapsed);
    dom.appShell.dataset.mobileSidebarOpen = String(mobileOpen);
    document.body.classList.toggle("sidebar-drawer-open", mobileOpen);

    dom.workspaceSidebarToggle.hidden = !mobile && !desktopCollapsed;
    dom.sidebarBackdrop.hidden = !mobile;
    dom.sidebarCollapseButton.setAttribute("aria-label", mobile ? "关闭侧边栏" : "折叠侧边栏");
    dom.workspaceSidebarToggle.setAttribute("aria-label", mobile ? "打开侧边栏" : "展开侧边栏");
    dom.sidebarResizeHandle.tabIndex = mobile || desktopCollapsed ? -1 : 0;
    dom.sidebarResizeHandle.setAttribute("aria-hidden", String(mobile || desktopCollapsed));
    updateResizeA11y();
  }

  function setDesktopCollapsed(nextCollapsed) {
    state.desktopCollapsed = Boolean(nextCollapsed);
    persistLayoutState();
    applyLayout();
  }

  function closeMobileSidebar() {
    if (!isMobileViewport() || !state.mobileOpen) {
      return;
    }

    state.mobileOpen = false;
    persistLayoutState();
    applyLayout();
  }

  return {
    initialize,
    closeMobileSidebar,
  };
}
