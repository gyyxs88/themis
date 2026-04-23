import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { AppServerActionBridge } from "../core/app-server-action-bridge.js";
import type { ManagedAgentControlPlaneFacadeLike } from "../core/managed-agent-control-plane-facade.js";
import { ManagedAgentExecutionService } from "../core/managed-agent-execution-service.js";
import { MeetingRoomRoundExecutor } from "../core/meeting-room-round-executor.js";
import { AppServerTaskRuntime } from "../core/app-server-task-runtime.js";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import type { RuntimeServiceHost } from "../core/runtime-service-host.js";
import type { RuntimeEngine, TaskRuntimeFacade } from "../types/index.js";
import { WebAccessService } from "../core/web-access.js";
import { ThemisUpdateService } from "../diagnostics/update-service.js";
import { servePlatformAsset, serveWebAsset } from "./http-assets.js";
import {
  handleActorCreate,
  handleActorList,
  handleMainMemoryCandidateExtract,
  handleMainMemoryCandidateList,
  handleMainMemoryCandidateReview,
  handleMainMemoryCandidateSuggest,
  handleActorTakeover,
  handleActorTimeline,
} from "./http-actors.js";
import {
  handlePrincipalAssetCreate,
  handlePrincipalAssetList,
  handlePrincipalAssetUpdate,
} from "./http-operations-assets.js";
import {
  handlePrincipalCadenceCreate,
  handlePrincipalCadenceList,
  handlePrincipalCadenceUpdate,
} from "./http-operations-cadences.js";
import {
  handlePrincipalCommitmentCreate,
  handlePrincipalCommitmentList,
  handlePrincipalCommitmentUpdate,
} from "./http-operations-commitments.js";
import { handlePrincipalOperationsBossView } from "./http-operations-boss-view.js";
import {
  handlePrincipalDecisionCreate,
  handlePrincipalDecisionList,
  handlePrincipalDecisionUpdate,
} from "./http-operations-decisions.js";
import {
  handlePrincipalOperationEdgeCreate,
  handlePrincipalOperationGraphQuery,
  handlePrincipalOperationEdgeList,
  handlePrincipalOperationEdgeUpdate,
} from "./http-operations-edges.js";
import {
  handlePrincipalRiskCreate,
  handlePrincipalRiskList,
  handlePrincipalRiskUpdate,
} from "./http-operations-risks.js";
import {
  handleAuthAccountCreate,
  handleAuthAccountSelect,
  handleAuthLogin,
  handleAuthLoginCancel,
  handleAuthLogout,
  handleAuthStatus,
} from "./http-auth.js";
import { toErrorMessage } from "./http-errors.js";
import { handleHistorySessionArchive, handleHistorySessionDetail, handleHistorySessions } from "./http-history.js";
import {
  handleIdentityLinkCodeCreate,
  handleIdentityPersonaUpdate,
  handleIdentityReset,
  handleIdentityStatus,
  handleIdentityTaskSettingsUpdate,
} from "./http-identity.js";
import { handleInputAssetUploadHttp } from "./http-input-assets.js";
import { handleRuntimeConfig } from "./http-runtime-config.js";
import {
  handleDiagnostics,
  handleDiagnosticsMcp,
  handleDiagnosticsMcpProbe,
  handleDiagnosticsMcpReload,
  type CreateMcpInspector,
} from "./http-diagnostics.js";
import {
  handleUpdateApplyHttp,
  handleUpdatesOverview,
  handleUpdateRollbackHttp,
} from "./http-updates.js";
import {
  handleSkillsCuratedCatalog,
  handleSkillsInstall,
  handleSkillsList,
  handleSkillsRemove,
  handleSkillsSync,
} from "./http-skills.js";
import {
  handleMcpDisable,
  handleMcpEnable,
  handleMcpList,
  handleMcpOauthLogin,
  handleMcpRemove,
  handleMcpReload,
  handleMcpUpsert,
} from "./http-mcp.js";
import {
  handlePluginsInstall,
  handlePluginsList,
  handlePluginsRead,
  handlePluginsSync,
  handlePluginsUninstall,
} from "./http-plugins.js";
import {
  handlePlatformAgentCardUpdate,
  handlePlatformAgentCreate,
  handlePlatformAgentDetail,
  handlePlatformAgentExecutionBoundaryUpdate,
  handlePlatformAgentArchive,
  handlePlatformAgentIdleSuggestions,
  handlePlatformAgentIdleApprove,
  handlePlatformAgentList,
  handlePlatformAgentPause,
  handlePlatformProjectWorkspaceBindingDetail,
  handlePlatformProjectWorkspaceBindingList,
  handlePlatformProjectWorkspaceBindingUpsert,
  handlePlatformAgentResume,
  handlePlatformAgentSpawnApprove,
  handlePlatformAgentSpawnIgnore,
  handlePlatformAgentSpawnPolicyUpdate,
  handlePlatformAgentSpawnReject,
  handlePlatformAgentSpawnRestore,
  handlePlatformAgentSpawnSuggestions,
  handlePlatformCollaborationDashboard,
  handlePlatformGovernanceOverview,
  handlePlatformHandoffList,
  handlePlatformMailboxAck,
  handlePlatformMailboxList,
  handlePlatformMailboxPull,
  handlePlatformMailboxRespond,
  handlePlatformNodeHeartbeat,
  handlePlatformNodeDetail,
  handlePlatformNodeDrain,
  handlePlatformNodeList,
  handlePlatformNodeOffline,
  handlePlatformNodeReclaim,
  handlePlatformNodeRegister,
  handlePlatformWorkerRunComplete,
  handlePlatformWorkerRunPull,
  handlePlatformWorkerRunUpdate,
  handlePlatformRunDetail,
  handlePlatformRunList,
  handlePlatformWaitingQueueList,
  type ManagedAgentWorkItemCancellationService,
  handlePlatformWorkItemCancel,
  handlePlatformWorkItemEscalate,
  handlePlatformWorkItemList,
  handlePlatformWorkItemDetail,
  handlePlatformWorkItemDispatch,
  handlePlatformWorkItemRespond,
} from "./http-platform.js";
import {
  handleScheduledTaskCancel,
  handleScheduledTaskCreate,
  handleScheduledTaskList,
} from "./http-scheduled-tasks.js";
import { buildPlatformRouteNotFoundErrorResponse } from "../contracts/managed-agent-platform-access.js";
import { writeJson } from "./http-responses.js";
import { maybeHandleWebAccessRoute, requireWebAccess } from "./http-web-access.js";
import {
  handleSessionForkContext,
  handleSessionSettingsRead,
  handleSessionSettingsWrite,
} from "./http-session-handlers.js";
import { handleTaskActionSubmit } from "./http-task-actions.js";
import { handleTaskAutomationRun, handleTaskRun, handleTaskStream } from "./http-task-handlers.js";
import {
  handleThirdPartyCapabilityWriteback,
  handleThirdPartyEndpointProbe,
  handleThirdPartyModelCreate,
  handleThirdPartyProbe,
  handleThirdPartyProviderCreate,
} from "./http-third-party-probe.js";
import { SyntheticSmokeTaskRuntime } from "./synthetic-smoke-task-runtime.js";
import type { PlatformMeetingRoomGateway } from "../core/platform-meeting-room-gateway.js";
import {
  handleMeetingRoomClose,
  handleMeetingRoomCreate,
  handleMeetingRoomCreateResolution,
  handleMeetingRoomDetail,
  handleMeetingRoomList,
  handleMeetingRoomMessageStream,
  handleMeetingRoomParticipantsAdd,
  handleMeetingRoomPromoteResolution,
  handleMeetingRoomStatus,
} from "./http-meeting-rooms.js";

const DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID = "principal-local-owner";

export interface ThemisServerRuntimeRegistry {
  defaultRuntime: TaskRuntimeFacade;
  runtimes?: Partial<Record<RuntimeEngine, TaskRuntimeFacade>>;
}

export interface ThemisHttpServerOptions {
  host?: string;
  port?: number;
  surface?: ThemisHttpServerSurface;
  runtime?: RuntimeServiceHost;
  runtimeRegistry?: ThemisServerRuntimeRegistry;
  authRuntime?: CodexAuthRuntime;
  taskTimeoutMs?: number;
  createMcpInspector?: CreateMcpInspector;
  actionBridge?: AppServerActionBridge;
  managedAgentExecutionService?: ManagedAgentExecutionService;
  platformManagedAgentExecutionService?: ManagedAgentWorkItemCancellationService;
  platformControlPlaneFacade?: ManagedAgentControlPlaneFacadeLike;
  platformMeetingRoomGateway?: PlatformMeetingRoomGateway | null;
  appServerRuntimeForMeetingRooms?: Pick<AppServerTaskRuntime, "runTaskAsPrincipal"> | null;
  meetingRoomRoundExecutor?: MeetingRoomRoundExecutor | null;
  feishuService?: {
    handleCardActionWebhook(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean>;
  };
  updateService?: ThemisUpdateService;
}

export type ThemisHttpServerSurface = "themis" | "platform";

export function createThemisHttpServer(options: ThemisHttpServerOptions = {}): Server {
  const actionBridge = options.actionBridge ?? new AppServerActionBridge();
  const runtime = options.runtime ?? new AppServerTaskRuntime({
    actionBridge,
  });
  const surface = resolveHttpServerSurface(options.surface);
  const defaultAppServerRuntime = resolveAppServerRuntime(options.runtimeRegistry)
    ?? new AppServerTaskRuntime({
      workingDirectory: runtime.getWorkingDirectory(),
      runtimeStore: runtime.getRuntimeStore(),
      actionBridge,
    });
  const syntheticSmokeRuntime = new SyntheticSmokeTaskRuntime({
    baseRuntime: runtime,
    actionBridge,
  });
  const runtimeRegistry = normalizeRuntimeRegistry(runtime, defaultAppServerRuntime, options.runtimeRegistry);
  const managedAgentExecutionService = options.managedAgentExecutionService ?? new ManagedAgentExecutionService({
    registry: defaultAppServerRuntime.getManagedAgentControlPlaneStore().executionStateStore,
    runtime: defaultAppServerRuntime,
    schedulerService: defaultAppServerRuntime.getManagedAgentSchedulerService(),
    coordinationService: defaultAppServerRuntime.getManagedAgentCoordinationService(),
  });
  const platformManagedAgentExecutionService =
    options.platformManagedAgentExecutionService ?? managedAgentExecutionService;
  const authRuntime = options.authRuntime ?? new CodexAuthRuntime({
    workingDirectory: runtime.getWorkingDirectory(),
    registry: runtime.getRuntimeStore(),
    onManagedAccountReady: async (account) => {
      try {
        await runtime.getPrincipalSkillsService().syncAllSkillsToAuthAccount(
          DEFAULT_PRIVATE_ASSISTANT_PRINCIPAL_ID,
          account.accountId,
        );
      } catch (error) {
        console.error(`[themis/auth] 自动补同步 skills 失败：${toErrorMessage(error)}`);
      }
    },
  });
  const runtimeStore = runtime.getRuntimeStore();
  const webAccessService = new WebAccessService({ registry: runtimeStore });
  const platformControlPlaneFacade = options.platformControlPlaneFacade
    ?? defaultAppServerRuntime.getManagedAgentControlPlaneFacadeAsync();
  const platformMeetingRoomGateway = options.platformMeetingRoomGateway ?? null;
  const appServerRuntimeForMeetingRooms = options.appServerRuntimeForMeetingRooms ?? defaultAppServerRuntime;
  const meetingRoomRoundExecutor = options.meetingRoomRoundExecutor ?? new MeetingRoomRoundExecutor();
  const updateService = options.updateService ?? new ThemisUpdateService({
    workingDirectory: runtime.getWorkingDirectory(),
  });
  const taskTimeoutMs = options.taskTimeoutMs ?? resolveTaskTimeoutMs();

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      const isHeadRequest = request.method === "HEAD";

      if (options.feishuService && await options.feishuService.handleCardActionWebhook(request, response, url)) {
        return;
      }

      if (await maybeHandleWebAccessRoute(request, response, webAccessService, {
        appDisplayName: surface.webAppDisplayName,
      })) {
        return;
      }

      if (!requireWebAccess(request, response, webAccessService, {
        appDisplayName: surface.webAppDisplayName,
      })) {
        return;
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/health") {
        return writeJson(response, 200, {
          ok: true,
          service: surface.healthServiceName,
        }, isHeadRequest);
      }

      if (isBlockedPlatformSurfaceApiPath(surface, url.pathname)) {
        return writeJson(response, 404, buildPlatformRouteNotFoundErrorResponse(url.pathname), isHeadRequest);
      }

      if (isRemovedPlatformCompatibilityApiPath(url.pathname)) {
        return writeJson(response, 404, {
          error: {
            code: "ROUTE_NOT_FOUND",
            message: `Themis main surface does not expose ${url.pathname}.`,
          },
        }, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/runtime/config") {
        return handleRuntimeConfig(response, runtime, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/diagnostics") {
        return handleDiagnostics(response, runtime, authRuntime, options.createMcpInspector, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/updates") {
        return handleUpdatesOverview(response, updateService, isHeadRequest);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/diagnostics/mcp") {
        return handleDiagnosticsMcp(response, runtime, authRuntime, options.createMcpInspector, isHeadRequest);
      }

      if (request.method === "POST" && url.pathname === "/api/diagnostics/mcp/probe") {
        return handleDiagnosticsMcpProbe(response, runtime, options.createMcpInspector);
      }

      if (request.method === "POST" && url.pathname === "/api/diagnostics/mcp/reload") {
        return handleDiagnosticsMcpReload(response, runtime, options.createMcpInspector);
      }

      if (request.method === "POST" && url.pathname === "/api/updates/apply") {
        return handleUpdateApplyHttp(request, response, runtime, updateService);
      }

      if (request.method === "POST" && url.pathname === "/api/updates/rollback") {
        return handleUpdateRollbackHttp(request, response, runtime, updateService);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/probe") {
        return handleThirdPartyProbe(request, response, runtime, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/codex-task-support") {
        return handleThirdPartyCapabilityWriteback(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/providers/endpoint-probe") {
        return handleThirdPartyEndpointProbe(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/providers") {
        return handleThirdPartyProviderCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/runtime/third-party/models") {
        return handleThirdPartyModelCreate(request, response, runtime);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/auth/status") {
        return handleAuthStatus(request, response, authRuntime, isHeadRequest);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/accounts") {
        return handleAuthAccountCreate(request, response, authRuntime, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/account/select") {
        return handleAuthAccountSelect(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/status") {
        return handleIdentityStatus(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/link-code") {
        return handleIdentityLinkCodeCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/reset") {
        return handleIdentityReset(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/persona") {
        return handleIdentityPersonaUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/identity/task-settings") {
        return handleIdentityTaskSettingsUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/actors/create") {
        return handleActorCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/create") {
        return handlePlatformAgentCreate(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/list") {
        return handlePlatformAgentList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/detail") {
        return handlePlatformAgentDetail(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/execution-boundary/update") {
        return handlePlatformAgentExecutionBoundaryUpdate(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/card/update") {
        return handlePlatformAgentCardUpdate(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/projects/workspace-binding/list") {
        return handlePlatformProjectWorkspaceBindingList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/projects/workspace-binding/detail") {
        return handlePlatformProjectWorkspaceBindingDetail(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/projects/workspace-binding/upsert") {
        return handlePlatformProjectWorkspaceBindingUpsert(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/spawn-suggestions") {
        return handlePlatformAgentSpawnSuggestions(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/idle-suggestions") {
        return handlePlatformAgentIdleSuggestions(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/spawn-policy/update") {
        return handlePlatformAgentSpawnPolicyUpdate(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/spawn-approve") {
        return handlePlatformAgentSpawnApprove(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/spawn-ignore") {
        return handlePlatformAgentSpawnIgnore(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/spawn-reject") {
        return handlePlatformAgentSpawnReject(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/spawn-restore") {
        return handlePlatformAgentSpawnRestore(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/idle-approve") {
        return handlePlatformAgentIdleApprove(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/pause") {
        return handlePlatformAgentPause(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/resume") {
        return handlePlatformAgentResume(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/archive") {
        return handlePlatformAgentArchive(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/waiting/list") {
        return handlePlatformWaitingQueueList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/governance-overview") {
        return handlePlatformGovernanceOverview(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/collaboration-dashboard") {
        return handlePlatformCollaborationDashboard(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/handoffs/list") {
        return handlePlatformHandoffList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/mailbox/list") {
        return handlePlatformMailboxList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/mailbox/pull") {
        return handlePlatformMailboxPull(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/mailbox/ack") {
        return handlePlatformMailboxAck(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/agents/mailbox/respond") {
        return handlePlatformMailboxRespond(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/work-items/list") {
        return handlePlatformWorkItemList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/work-items/dispatch") {
        return handlePlatformWorkItemDispatch(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/work-items/cancel") {
        return handlePlatformWorkItemCancel(request, response, platformManagedAgentExecutionService);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/work-items/respond") {
        return handlePlatformWorkItemRespond(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/work-items/escalate") {
        return handlePlatformWorkItemEscalate(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/work-items/detail") {
        return handlePlatformWorkItemDetail(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/runs/list") {
        return handlePlatformRunList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/runs/detail") {
        return handlePlatformRunDetail(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/nodes/register") {
        return handlePlatformNodeRegister(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/nodes/heartbeat") {
        return handlePlatformNodeHeartbeat(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/nodes/list") {
        return handlePlatformNodeList(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/nodes/detail") {
        return handlePlatformNodeDetail(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/nodes/drain") {
        return handlePlatformNodeDrain(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/nodes/offline") {
        return handlePlatformNodeOffline(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/nodes/reclaim") {
        return handlePlatformNodeReclaim(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/worker/runs/pull") {
        return handlePlatformWorkerRunPull(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/worker/runs/update") {
        return handlePlatformWorkerRunUpdate(request, response, platformControlPlaneFacade);
      }

      if (request.method === "POST" && url.pathname === "/api/platform/worker/runs/complete") {
        return handlePlatformWorkerRunComplete(request, response, platformControlPlaneFacade);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/meeting-rooms/status") {
        return handleMeetingRoomStatus(response, {
          gateway: platformMeetingRoomGateway,
        }, isHeadRequest);
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/list") {
        return handleMeetingRoomList(request, response, {
          gateway: platformMeetingRoomGateway,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/create") {
        return handleMeetingRoomCreate(request, response, {
          gateway: platformMeetingRoomGateway,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/detail") {
        return handleMeetingRoomDetail(request, response, {
          gateway: platformMeetingRoomGateway,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/participants/add") {
        return handleMeetingRoomParticipantsAdd(request, response, {
          gateway: platformMeetingRoomGateway,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/message/stream") {
        return handleMeetingRoomMessageStream(request, response, {
          gateway: platformMeetingRoomGateway,
          runtime: appServerRuntimeForMeetingRooms,
          roundExecutor: meetingRoomRoundExecutor,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/resolutions/create") {
        return handleMeetingRoomCreateResolution(request, response, {
          gateway: platformMeetingRoomGateway,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/resolutions/promote") {
        return handleMeetingRoomPromoteResolution(request, response, {
          gateway: platformMeetingRoomGateway,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/meeting-rooms/close") {
        return handleMeetingRoomClose(request, response, {
          gateway: platformMeetingRoomGateway,
        });
      }

      if (request.method === "POST" && url.pathname === "/api/actors/list") {
        return handleActorList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/actors/timeline") {
        return handleActorTimeline(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/actors/takeover") {
        return handleActorTakeover(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/actors/memory-candidates/suggest") {
        return handleMainMemoryCandidateSuggest(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/actors/memory-candidates/list") {
        return handleMainMemoryCandidateList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/actors/memory-candidates/extract") {
        return handleMainMemoryCandidateExtract(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/actors/memory-candidates/review") {
        return handleMainMemoryCandidateReview(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/assets/list") {
        return handlePrincipalAssetList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/boss-view") {
        return handlePrincipalOperationsBossView(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/assets/create") {
        return handlePrincipalAssetCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/assets/update") {
        return handlePrincipalAssetUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/decisions/list") {
        return handlePrincipalDecisionList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/decisions/create") {
        return handlePrincipalDecisionCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/decisions/update") {
        return handlePrincipalDecisionUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/cadences/list") {
        return handlePrincipalCadenceList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/cadences/create") {
        return handlePrincipalCadenceCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/cadences/update") {
        return handlePrincipalCadenceUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/commitments/list") {
        return handlePrincipalCommitmentList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/commitments/create") {
        return handlePrincipalCommitmentCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/commitments/update") {
        return handlePrincipalCommitmentUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/edges/list") {
        return handlePrincipalOperationEdgeList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/graph/query") {
        return handlePrincipalOperationGraphQuery(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/edges/create") {
        return handlePrincipalOperationEdgeCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/edges/update") {
        return handlePrincipalOperationEdgeUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/risks/list") {
        return handlePrincipalRiskList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/risks/create") {
        return handlePrincipalRiskCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/operations/risks/update") {
        return handlePrincipalRiskUpdate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/list") {
        return handleSkillsList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/install") {
        return handleSkillsInstall(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/remove") {
        return handleSkillsRemove(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/sync") {
        return handleSkillsSync(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/skills/catalog/curated") {
        return handleSkillsCuratedCatalog(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/mcp/list") {
        return handleMcpList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/mcp/reload") {
        return handleMcpReload(request, response, runtime, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/mcp/upsert") {
        return handleMcpUpsert(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/mcp/remove") {
        return handleMcpRemove(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/mcp/oauth/login") {
        return handleMcpOauthLogin(request, response, runtime, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/mcp/enable") {
        return handleMcpEnable(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/mcp/disable") {
        return handleMcpDisable(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/plugins/list") {
        return handlePluginsList(request, response, runtime, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/plugins/read") {
        return handlePluginsRead(request, response, runtime, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/plugins/install") {
        return handlePluginsInstall(request, response, runtime, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/plugins/uninstall") {
        return handlePluginsUninstall(request, response, runtime, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/plugins/sync") {
        return handlePluginsSync(request, response, runtime, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/scheduled-tasks/create") {
        return handleScheduledTaskCreate(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/scheduled-tasks/list") {
        return handleScheduledTaskList(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/scheduled-tasks/cancel") {
        return handleScheduledTaskCancel(request, response, runtime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login") {
        return handleAuthLogin(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/login/cancel") {
        return handleAuthLoginCancel(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        return handleAuthLogout(request, response, authRuntime);
      }

      if (request.method === "POST" && url.pathname === "/api/input-assets") {
        return handleInputAssetUploadHttp(request, response, {
          workingDirectory: runtime.getWorkingDirectory(),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/run") {
        return handleTaskRun(request, response, runtime, runtimeRegistry, authRuntime, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/automation/run") {
        return handleTaskAutomationRun(request, response, runtime, runtimeRegistry, authRuntime, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/stream") {
        return handleTaskStream(request, response, runtime, runtimeRegistry, authRuntime, actionBridge, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/smoke") {
        return handleTaskStream(request, response, runtime, {
          defaultRuntime: syntheticSmokeRuntime,
        }, authRuntime, actionBridge, taskTimeoutMs);
      }

      if (request.method === "POST" && url.pathname === "/api/tasks/actions") {
        return await handleTaskActionSubmit(request, response, actionBridge, runtimeRegistry);
      }

      if (request.method === "POST" && url.pathname === "/api/sessions/fork-context") {
        return handleSessionForkContext(request, response, runtimeRegistry);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/settings")) {
        return handleSessionSettingsRead(url, response, runtimeStore, isHeadRequest);
      }

      if ((request.method === "PUT" || request.method === "POST") && url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/settings")) {
        return handleSessionSettingsWrite(request, response, runtimeStore);
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname === "/api/history/sessions") {
        return handleHistorySessions(url, response, runtimeStore, isHeadRequest);
      }

      if ((request.method === "POST" || request.method === "DELETE" || isHeadRequest) && url.pathname.endsWith("/archive") && url.pathname.startsWith("/api/history/sessions/")) {
        return handleHistorySessionArchive(
          url,
          response,
          runtimeStore,
          request.method !== "DELETE",
          isHeadRequest,
        );
      }

      if ((request.method === "GET" || isHeadRequest) && url.pathname.startsWith("/api/history/sessions/")) {
        return await handleHistorySessionDetail(url, response, runtimeStore, runtimeRegistry, isHeadRequest);
      }

      if (request.method === "GET" || isHeadRequest) {
        return serveHttpSurfaceAsset(surface, url.pathname, response, isHeadRequest);
      }

      return writeJson(response, 405, {
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: `Unsupported method: ${request.method ?? "UNKNOWN"}`,
        },
      });
    } catch (error) {
      return writeJson(response, 500, {
        error: {
          code: "SERVER_ERROR",
          message: toErrorMessage(error),
        },
      });
    }
  });
}

interface ResolvedHttpServerSurface {
  id: ThemisHttpServerSurface;
  webAppDisplayName: string;
  healthServiceName: string;
}

export function resolveListenAddresses(host: string, port: number): string[] {
  const addresses = new Set<string>();
  addresses.add(`http://localhost:${port}`);

  if (host !== "0.0.0.0") {
    addresses.add(`http://${host}:${port}`);
    return [...addresses];
  }

  const interfaces = networkInterfaces();

  for (const values of Object.values(interfaces)) {
    for (const entry of values ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.add(`http://${entry.address}:${port}`);
      }
    }
  }

  return [...addresses];
}

function resolveHttpServerSurface(surface: ThemisHttpServerSurface | undefined): ResolvedHttpServerSurface {
  if (surface === "platform") {
    return {
      id: "platform",
      webAppDisplayName: "Themis Platform",
      healthServiceName: "themis-platform",
    };
  }

  return {
    id: "themis",
    webAppDisplayName: "Themis Web",
    healthServiceName: "themis-webui",
  };
}

function isBlockedPlatformSurfaceApiPath(surface: ResolvedHttpServerSurface, pathname: string): boolean {
  return surface.id === "platform"
    && pathname.startsWith("/api/")
    && !pathname.startsWith("/api/platform/");
}

function isRemovedPlatformCompatibilityApiPath(pathname: string): boolean {
  return pathname === "/api/agents" || pathname.startsWith("/api/agents/");
}

async function serveHttpSurfaceAsset(
  surface: ResolvedHttpServerSurface,
  pathname: string,
  response: ServerResponse,
  headOnly: boolean,
): Promise<void> {
  if (surface.id === "themis") {
    return serveWebAsset(pathname, response, headOnly);
  }

  return servePlatformAsset(pathname, response, headOnly);
}

function normalizeRuntimeRegistry(
  runtime: Pick<RuntimeServiceHost, "getRuntimeStore">,
  defaultAppServerRuntime: TaskRuntimeFacade,
  runtimeRegistry: ThemisServerRuntimeRegistry | undefined,
): ThemisServerRuntimeRegistry {
  if (!runtimeRegistry) {
    return {
      defaultRuntime: defaultAppServerRuntime,
      runtimes: {
        "app-server": defaultAppServerRuntime,
      },
    };
  }

  const defaultRuntime = runtimeRegistry.defaultRuntime;
  const normalizedRegistry: ThemisServerRuntimeRegistry = {
    defaultRuntime,
    ...(runtimeRegistry.runtimes ? { runtimes: { ...runtimeRegistry.runtimes } } : {}),
  };
  const baseStore = runtime.getRuntimeStore();

  if (defaultRuntime.getRuntimeStore() !== baseStore) {
    throw new Error("Task runtime store mismatch for default runtime: all runtimes must share the base runtime store.");
  }

  for (const [engine, registeredRuntime] of Object.entries(normalizedRegistry.runtimes ?? {})) {
    if (!registeredRuntime) {
      continue;
    }

    if (registeredRuntime.getRuntimeStore() !== baseStore) {
      throw new Error(`Task runtime store mismatch for engine "${engine}": all runtimes must share the base runtime store.`);
    }
  }

  return normalizedRegistry;
}

function resolveAppServerRuntime(runtimeRegistry: ThemisServerRuntimeRegistry | undefined): AppServerTaskRuntime | null {
  const runtime = runtimeRegistry?.runtimes?.["app-server"] ?? runtimeRegistry?.defaultRuntime;
  return runtime instanceof AppServerTaskRuntime ? runtime : null;
}

function resolveTaskTimeoutMs(): number {
  const rawValue = process.env.THEMIS_TASK_TIMEOUT_MS ?? "300000";
  const parsed = Number.parseInt(rawValue, 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 300000;
}
