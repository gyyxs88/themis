import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPlatformRouteNotFoundErrorResponse,
  buildPlatformServiceAuthorizationHeader,
  buildPlatformServiceAuthDeniedErrorResponse,
  buildPlatformServiceForbiddenErrorResponse,
  buildPlatformServiceOwnerMismatchErrorResponse,
} from "./managed-agent-platform-access.js";

test("平台 access 契约会统一 Bearer 鉴权头格式", () => {
  assert.equal(buildPlatformServiceAuthorizationHeader("platform-secret"), "Bearer platform-secret");
});

test("平台 access 契约会统一平台专用错误响应", () => {
  assert.deepEqual(buildPlatformRouteNotFoundErrorResponse("/api/runtime/config"), {
    error: {
      code: "PLATFORM_ROUTE_NOT_FOUND",
      message: "Platform surface does not expose /api/runtime/config.",
    },
  });

  assert.deepEqual(buildPlatformServiceAuthDeniedErrorResponse(), {
    error: {
      code: "PLATFORM_SERVICE_AUTH_DENIED",
      message: "平台服务令牌无效。",
    },
  });

  assert.deepEqual(buildPlatformServiceForbiddenErrorResponse(), {
    error: {
      code: "PLATFORM_SERVICE_FORBIDDEN",
      message: "当前平台服务令牌无权访问该接口。",
    },
  });

  assert.deepEqual(buildPlatformServiceOwnerMismatchErrorResponse(), {
    error: {
      code: "PLATFORM_SERVICE_OWNER_MISMATCH",
      message: "平台服务令牌与 ownerPrincipalId 不匹配。",
    },
  });
});
