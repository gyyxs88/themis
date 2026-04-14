import type { ManagedAgentControlPlaneFacadeLike } from "../core/managed-agent-control-plane-facade.js";
import {
  createManagedAgentPlatformGatewayFacade,
} from "../core/managed-agent-platform-gateway-facade.js";
import {
  readManagedAgentPlatformGatewayConfig,
} from "../core/managed-agent-platform-gateway-client.js";

export interface ResolveMainPlatformGatewayFacadeOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export function resolveMainPlatformGatewayFacade(
  options: ResolveMainPlatformGatewayFacadeOptions = {},
): ManagedAgentControlPlaneFacadeLike | undefined {
  const config = readManagedAgentPlatformGatewayConfig(options.env);

  if (!config) {
    return undefined;
  }

  return createManagedAgentPlatformGatewayFacade({
    ...config,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
}
