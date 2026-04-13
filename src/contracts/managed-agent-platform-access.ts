export const PLATFORM_SERVICE_AUTHORIZATION_SCHEME = "Bearer";

export const PLATFORM_ROUTE_NOT_FOUND_CODE = "PLATFORM_ROUTE_NOT_FOUND";
export const PLATFORM_SERVICE_AUTH_DENIED_CODE = "PLATFORM_SERVICE_AUTH_DENIED";
export const PLATFORM_SERVICE_FORBIDDEN_CODE = "PLATFORM_SERVICE_FORBIDDEN";
export const PLATFORM_SERVICE_OWNER_MISMATCH_CODE = "PLATFORM_SERVICE_OWNER_MISMATCH";

export type ManagedAgentPlatformAccessErrorCode =
  | typeof PLATFORM_ROUTE_NOT_FOUND_CODE
  | typeof PLATFORM_SERVICE_AUTH_DENIED_CODE
  | typeof PLATFORM_SERVICE_FORBIDDEN_CODE
  | typeof PLATFORM_SERVICE_OWNER_MISMATCH_CODE;

export interface ManagedAgentPlatformErrorDetail<Code extends string = ManagedAgentPlatformAccessErrorCode> {
  code: Code;
  message: string;
}

export interface ManagedAgentPlatformErrorResponse<Code extends string = ManagedAgentPlatformAccessErrorCode> {
  error: ManagedAgentPlatformErrorDetail<Code>;
}

export function buildPlatformServiceAuthorizationHeader(secret: string): string {
  return `${PLATFORM_SERVICE_AUTHORIZATION_SCHEME} ${secret}`;
}

export function readPlatformServiceAuthorizationHeader(authorizationHeader: string | undefined): string | null {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function buildPlatformRouteNotFoundErrorResponse(
  pathname: string,
): ManagedAgentPlatformErrorResponse<typeof PLATFORM_ROUTE_NOT_FOUND_CODE> {
  return {
    error: {
      code: PLATFORM_ROUTE_NOT_FOUND_CODE,
      message: `Platform surface does not expose ${pathname}.`,
    },
  };
}

export function buildPlatformServiceAuthDeniedErrorResponse():
ManagedAgentPlatformErrorResponse<typeof PLATFORM_SERVICE_AUTH_DENIED_CODE> {
  return {
    error: {
      code: PLATFORM_SERVICE_AUTH_DENIED_CODE,
      message: "平台服务令牌无效。",
    },
  };
}

export function buildPlatformServiceForbiddenErrorResponse():
ManagedAgentPlatformErrorResponse<typeof PLATFORM_SERVICE_FORBIDDEN_CODE> {
  return {
    error: {
      code: PLATFORM_SERVICE_FORBIDDEN_CODE,
      message: "当前平台服务令牌无权访问该接口。",
    },
  };
}

export function buildPlatformServiceOwnerMismatchErrorResponse():
ManagedAgentPlatformErrorResponse<typeof PLATFORM_SERVICE_OWNER_MISMATCH_CODE> {
  return {
    error: {
      code: PLATFORM_SERVICE_OWNER_MISMATCH_CODE,
      message: "平台服务令牌与 ownerPrincipalId 不匹配。",
    },
  };
}
