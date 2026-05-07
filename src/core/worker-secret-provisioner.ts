import { ThemisSecretStore } from "./themis-secret-store.js";
import { ManagedAgentPlatformGatewayClient, readManagedAgentPlatformGatewayConfig } from "./managed-agent-platform-gateway-client.js";
import { WorkerSecretStore } from "./worker-secret-store.js";

export interface WorkerSecretProvisionerOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  themisSecretStore?: ThemisSecretStore;
  workerSecretStore?: WorkerSecretStore;
  platformGatewayClient?: Pick<ManagedAgentPlatformGatewayClient, "pushWorkerSecret">;
}

export interface ProvisionWorkerSecretInput {
  sourceSecretRef: string;
  secretRef?: string;
  envName?: string;
  forceRefresh?: boolean;
  dryRun?: boolean;
  targetNodeIds?: string[];
}

export type WorkerSecretProvisionStatus = "already_configured" | "dry_run_ready" | "provisioned";
export type WorkerSecretProvisionSource = "worker_secret_store" | "themis_secret";

export interface WorkerSecretProvisionDelivery {
  nodeId: string;
  secretRef: string;
  deliveryId: string;
  status: string;
}

export interface WorkerSecretProvisionResult {
  status: WorkerSecretProvisionStatus;
  source: WorkerSecretProvisionSource;
  sourceSecretRef: string;
  secretRef: string;
  envName?: string;
  workerSecretStorePath: string;
  themisSecretStorePath: string;
  targetNodeIds?: string[];
  deliveries?: WorkerSecretProvisionDelivery[];
  written: boolean;
}

export class WorkerSecretProvisioner {
  private readonly env: NodeJS.ProcessEnv;
  private readonly fetchImpl: typeof fetch;
  private readonly themisSecretStore: ThemisSecretStore;
  private readonly workerSecretStore: WorkerSecretStore;
  private readonly platformGatewayClient: Pick<ManagedAgentPlatformGatewayClient, "pushWorkerSecret"> | undefined;

  constructor(options: WorkerSecretProvisionerOptions = {}) {
    const cwd = options.cwd ?? process.cwd();
    this.env = options.env ?? process.env;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.themisSecretStore = options.themisSecretStore ?? new ThemisSecretStore({
      cwd,
      env: this.env,
    });
    this.workerSecretStore = options.workerSecretStore ?? new WorkerSecretStore({
      cwd,
      env: this.env,
    });
    this.platformGatewayClient = options.platformGatewayClient;
  }

  async provisionWorkerSecret(input: ProvisionWorkerSecretInput): Promise<WorkerSecretProvisionResult> {
    const sourceSecretRef = normalizeSecretRef(input.sourceSecretRef);
    const secretRef = normalizeSecretRef(input.secretRef ?? sourceSecretRef);
    const envName = normalizeOptionalText(input.envName);
    const forceRefresh = input.forceRefresh === true;
    const dryRun = input.dryRun === true;
    const targetNodeIds = normalizeTargetNodeIds(input.targetNodeIds ?? []);
    const workerSnapshot = this.workerSecretStore.readSnapshot();
    const themisSnapshot = this.themisSecretStore.readSnapshot();

    if (!forceRefresh && workerSnapshot.secretRefs.includes(secretRef)) {
      const existingValue = this.workerSecretStore.getSecret(secretRef);
      const deliveries = !dryRun && targetNodeIds.length > 0
        ? await this.deliverWorkerSecretToNodes(secretRef, existingValue, targetNodeIds)
        : [];

      return {
        status: "already_configured",
        source: "worker_secret_store",
        sourceSecretRef,
        secretRef,
        ...(envName ? { envName } : {}),
        workerSecretStorePath: workerSnapshot.filePath,
        themisSecretStorePath: themisSnapshot.filePath,
        ...(targetNodeIds.length > 0 ? { targetNodeIds } : {}),
        ...(deliveries.length > 0 ? { deliveries } : {}),
        written: false,
      };
    }

    const value = this.themisSecretStore.getSecret(sourceSecretRef);

    if (!value) {
      throw new Error(`Themis 密码本未配置 ${sourceSecretRef}，无法下发到 worker secret store。`);
    }

    if (!dryRun) {
      this.workerSecretStore.setSecret(secretRef, value);
    }

    const deliveries = !dryRun && targetNodeIds.length > 0
      ? await this.deliverWorkerSecretToNodes(secretRef, value, targetNodeIds)
      : [];

    return {
      status: dryRun ? "dry_run_ready" : "provisioned",
      source: "themis_secret",
      sourceSecretRef,
      secretRef,
      ...(envName ? { envName } : {}),
      workerSecretStorePath: this.workerSecretStore.getFilePath(),
      themisSecretStorePath: this.themisSecretStore.getFilePath(),
      ...(targetNodeIds.length > 0 ? { targetNodeIds } : {}),
      ...(deliveries.length > 0 ? { deliveries } : {}),
      written: !dryRun,
    };
  }

  private async deliverWorkerSecretToNodes(
    secretRef: string,
    value: string | null,
    targetNodeIds: string[],
  ): Promise<WorkerSecretProvisionDelivery[]> {
    if (!value) {
      throw new Error(`worker secret store 中存在 ${secretRef}，但无法读取有效值，不能下发到 worker node。`);
    }

    const client = this.resolvePlatformGatewayClient();
    const deliveries: WorkerSecretProvisionDelivery[] = [];

    for (const nodeId of targetNodeIds) {
      const result = await client.pushWorkerSecret({
        nodeId,
        secretRef,
        value,
      });
      deliveries.push({
        nodeId: result.delivery.nodeId,
        secretRef: result.delivery.secretRef,
        deliveryId: result.delivery.deliveryId,
        status: result.delivery.status,
      });
    }

    return deliveries;
  }

  private resolvePlatformGatewayClient(): Pick<ManagedAgentPlatformGatewayClient, "pushWorkerSecret"> {
    if (this.platformGatewayClient) {
      return this.platformGatewayClient;
    }

    const config = readManagedAgentPlatformGatewayConfig(this.env);

    if (!config) {
      throw new Error(
        "需要下发 worker secret 到指定 node，但未配置 THEMIS_PLATFORM_BASE_URL / "
        + "THEMIS_PLATFORM_OWNER_PRINCIPAL_ID / THEMIS_PLATFORM_WEB_ACCESS_TOKEN。",
      );
    }

    return new ManagedAgentPlatformGatewayClient({
      ...config,
      fetchImpl: this.fetchImpl,
    });
  }
}

function normalizeSecretRef(value: string): string {
  const normalized = normalizeOptionalText(value);

  if (!normalized) {
    throw new Error("secretRef 不能为空。");
  }

  if (/\s/.test(normalized)) {
    throw new Error("secretRef 不能包含空白字符。");
  }

  if (normalized.length > 160) {
    throw new Error("secretRef 过长。");
  }

  return normalized;
}

function normalizeTargetNodeIds(value: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const item of value) {
    const normalized = normalizeOptionalText(item);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}
