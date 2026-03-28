import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { CodexAuthRuntime } from "../core/codex-auth.js";
import { CodexTaskRuntime } from "../core/codex-runtime.js";
import { PrincipalSkillsService } from "../core/principal-skills-service.js";
import { SqliteCodexSessionRegistry } from "../storage/index.js";
import { createThemisHttpServer } from "./http-server.js";
import { createAuthenticatedWebHeaders } from "./http-test-helpers.js";

const PRINCIPAL_ID = "principal-local-owner";

interface TestServerContext {
  server: Server;
  baseUrl: string;
  root: string;
  runtimeStore: SqliteCodexSessionRegistry;
  runtime: CodexTaskRuntime;
  authRuntime: CodexAuthRuntime;
  principalSkillsService: PrincipalSkillsService;
  managedAccountId: string;
  authHeaders: Record<string, string>;
}

function buildSkillsIdentityPayload(): {
  channel: string;
  channelUserId: string;
  displayName: string;
} {
  return {
    channel: "web",
    channelUserId: "browser-user-1",
    displayName: "owner",
  };
}

async function withSkillsServer(
  run: (context: TestServerContext) => Promise<void>,
  options: {
    execScript?: (
      command: string[],
      scriptOptions?: { cwd?: string; env?: Record<string, string> },
    ) => Promise<string>;
  } = {},
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "themis-http-skills-"));
  const runtimeStore = new SqliteCodexSessionRegistry({
    databaseFile: join(root, "infra/local/themis.db"),
  });
  const principalSkillsService = new PrincipalSkillsService({
    workingDirectory: root,
    registry: runtimeStore,
    ...(options.execScript ? { execScript: options.execScript } : {}),
  });
  const runtime = new CodexTaskRuntime({
    workingDirectory: root,
    runtimeStore,
    principalSkillsService,
  });
  const authRuntime = new CodexAuthRuntime({
    workingDirectory: root,
    registry: runtimeStore,
  });
  const managedAccount = authRuntime.createAccount({
    label: "Managed Account",
    activate: false,
  });
  const server = createThemisHttpServer({ runtime, authRuntime });
  const listeningServer = await listenServer(server);
  const address = listeningServer.address();

  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve server address.");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;
  const authHeaders = await createAuthenticatedWebHeaders({
    baseUrl,
    runtimeStore,
  });

  try {
    await run({
      server: listeningServer,
      baseUrl,
      root,
      runtimeStore,
      runtime,
      authRuntime,
      principalSkillsService,
      managedAccountId: managedAccount.accountId,
      authHeaders,
    });
  } finally {
    await closeServer(listeningServer);
    rmSync(root, { recursive: true, force: true });
  }
}

function createLocalSkillFixture(input: {
  dirName: string;
  skillName: string;
  description: string;
}): { root: string; skillDir: string } {
  const root = mkdtempSync(join(tmpdir(), "themis-http-skill-fixture-"));
  const skillDir = resolve(root, input.dirName);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    resolve(skillDir, "SKILL.md"),
    [
      "---",
      `name: ${input.skillName}`,
      `description: ${input.description}`,
      "---",
      "",
      "# Demo",
      "",
    ].join("\n"),
    "utf8",
  );

  return { root, skillDir };
}

async function postJson(
  baseUrl: string,
  pathname: string,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}${pathname}`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

async function assertInvalidRequest(
  responsePromise: Promise<Response>,
  expectedMessage: RegExp | string,
): Promise<void> {
  const response = await responsePromise;
  assert.equal(response.status, 400);

  const payload = await response.json() as {
    error?: {
      code?: string;
      message?: string;
    };
  };
  assert.equal(payload.error?.code, "INVALID_REQUEST");

  if (typeof expectedMessage === "string") {
    assert.equal(payload.error?.message, expectedMessage);
    return;
  }

  assert.match(payload.error?.message ?? "", expectedMessage);
}

test("POST /api/skills/list 会按当前浏览器身份返回 principal skill 列表", async () => {
  await withSkillsServer(async ({ baseUrl, runtime, principalSkillsService, managedAccountId, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildSkillsIdentityPayload());
    const fixture = createLocalSkillFixture({
      dirName: "demo",
      skillName: "demo-skill",
      description: "demo",
    });

    try {
      await principalSkillsService.installFromLocalPath({
        principalId: identity.principalId,
        absolutePath: fixture.skillDir,
      });

      const response = await postJson(baseUrl, "/api/skills/list", buildSkillsIdentityPayload(), authHeaders);
      assert.equal(response.status, 200);

      const payload = await response.json() as {
        identity?: { principalId?: string };
        skills?: Array<{
          skillName?: string;
          description?: string;
          installStatus?: string;
          summary?: { totalAccounts?: number; syncedCount?: number };
          materializations?: Array<{ targetId?: string; state?: string }>;
        }>;
      };
      assert.equal(payload.identity?.principalId, PRINCIPAL_ID);
      assert.equal(payload.skills?.length, 1);
      assert.equal(payload.skills?.[0]?.skillName, "demo-skill");
      assert.equal(payload.skills?.[0]?.description, "demo");
      assert.equal(payload.skills?.[0]?.installStatus, "ready");
      assert.equal(payload.skills?.[0]?.summary?.totalAccounts, 1);
      assert.equal(payload.skills?.[0]?.summary?.syncedCount, 1);
      assert.deepEqual(
        payload.skills?.[0]?.materializations?.map((item) => ({
          targetId: item.targetId,
          state: item.state,
        })),
        [
          { targetId: managedAccountId, state: "synced" },
        ],
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("POST /api/skills/install 会支持 local-path 安装", async () => {
  await withSkillsServer(async ({ baseUrl, runtimeStore, managedAccountId, authHeaders }) => {
    const fixture = createLocalSkillFixture({
      dirName: "demo",
      skillName: "demo-skill",
      description: "demo",
    });

    try {
      const response = await postJson(baseUrl, "/api/skills/install", {
        ...buildSkillsIdentityPayload(),
        source: {
          type: "local-path",
          absolutePath: fixture.skillDir,
        },
      }, authHeaders);

      assert.equal(response.status, 200);

      const payload = await response.json() as {
        result?: {
          skill?: { skillName?: string };
          summary?: { totalAccounts?: number; syncedCount?: number };
        };
      };
      assert.equal(payload.result?.skill?.skillName, "demo-skill");
      assert.equal(payload.result?.summary?.totalAccounts, 1);
      assert.equal(payload.result?.summary?.syncedCount, 1);
      assert.equal(runtimeStore.getPrincipalSkill(PRINCIPAL_ID, "demo-skill")?.skillName, "demo-skill");
      assert.equal(
        lstatSync(resolve(
          runtimeStore.getAuthAccount(managedAccountId)?.codexHome ?? "",
          "skills",
          "demo-skill",
        )).isSymbolicLink(),
        true,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("POST /api/skills/remove 会删除 principal skill 和账号槽位物化", async () => {
  await withSkillsServer(async ({ baseUrl, runtime, principalSkillsService, runtimeStore, managedAccountId, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildSkillsIdentityPayload());
    const fixture = createLocalSkillFixture({
      dirName: "demo",
      skillName: "demo-skill",
      description: "demo",
    });

    try {
      await principalSkillsService.installFromLocalPath({
        principalId: identity.principalId,
        absolutePath: fixture.skillDir,
      });

      const response = await postJson(baseUrl, "/api/skills/remove", {
        ...buildSkillsIdentityPayload(),
        skillName: "demo-skill",
      }, authHeaders);

      assert.equal(response.status, 200);
      assert.equal(runtimeStore.getPrincipalSkill(PRINCIPAL_ID, "demo-skill"), null);
      assert.equal(runtimeStore.listPrincipalSkillMaterializations(PRINCIPAL_ID, "demo-skill").length, 0);
      assert.equal(
        existsSync(resolve(
          runtimeStore.getAuthAccount(managedAccountId)?.codexHome ?? "",
          "skills",
          "demo-skill",
        )),
        false,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("POST /api/skills/sync 会重建缺失的账号槽位物化", async () => {
  await withSkillsServer(async ({ baseUrl, runtime, principalSkillsService, runtimeStore, managedAccountId, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildSkillsIdentityPayload());
    const fixture = createLocalSkillFixture({
      dirName: "demo",
      skillName: "demo-skill",
      description: "demo",
    });

    try {
      await principalSkillsService.installFromLocalPath({
        principalId: identity.principalId,
        absolutePath: fixture.skillDir,
      });

      const targetPath = resolve(
        runtimeStore.getAuthAccount(managedAccountId)?.codexHome ?? "",
        "skills",
        "demo-skill",
      );
      rmSync(targetPath, { recursive: true, force: true });

      const response = await postJson(baseUrl, "/api/skills/sync", {
        ...buildSkillsIdentityPayload(),
        skillName: "demo-skill",
      }, authHeaders);

      assert.equal(response.status, 200);
      assert.equal(lstatSync(targetPath).isSymbolicLink(), true);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("POST /api/skills/catalog/curated 会返回 curated catalog 并标记是否已安装", async () => {
  await withSkillsServer(
    async ({ baseUrl, runtime, principalSkillsService, authHeaders }) => {
      const identity = runtime.getIdentityLinkService().ensureIdentity(buildSkillsIdentityPayload());
      const fixture = createLocalSkillFixture({
        dirName: "python-setup",
        skillName: "python-setup",
        description: "python",
      });

      try {
        await principalSkillsService.installFromLocalPath({
          principalId: identity.principalId,
          absolutePath: fixture.skillDir,
        });

        const response = await postJson(baseUrl, "/api/skills/catalog/curated", buildSkillsIdentityPayload(), authHeaders);
        assert.equal(response.status, 200);

        const payload = await response.json() as {
          curated?: Array<{ name?: string; installed?: boolean }>;
        };
        assert.deepEqual(payload.curated, [
          { name: "debugger", installed: false },
          { name: "python-setup", installed: true },
        ]);
      } finally {
        rmSync(fixture.root, { recursive: true, force: true });
      }
    },
    {
      execScript: async (command) => {
        assert.equal(command.some((part) => part.endsWith("/list-skills.py")), true);

        return JSON.stringify([
          { name: "debugger" },
          { name: "python-setup" },
        ]);
      },
    },
  );
});

test("POST /api/auth/accounts 创建新账号后会自动补同步当前 principal 已安装 skills", async () => {
  await withSkillsServer(async ({ baseUrl, runtime, principalSkillsService, runtimeStore, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildSkillsIdentityPayload());
    const fixture = createLocalSkillFixture({
      dirName: "demo",
      skillName: "demo-skill",
      description: "demo",
    });

    try {
      await principalSkillsService.installFromLocalPath({
        principalId: identity.principalId,
        absolutePath: fixture.skillDir,
      });

      const response = await postJson(baseUrl, "/api/auth/accounts", {
        label: "backup",
        activate: false,
      }, authHeaders);

      assert.equal(response.status, 200);

      const payload = await response.json() as {
        account?: { accountId?: string };
      };
      const accountId = payload.account?.accountId ?? "";
      assert.ok(accountId);
      assert.equal(
        lstatSync(resolve(
          runtimeStore.getAuthAccount(accountId)?.codexHome ?? "",
          "skills",
          "demo-skill",
        )).isSymbolicLink(),
        true,
      );
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("POST /api/identity/reset 会删除 principal skills 的受管目录和账号槽位物化", async () => {
  await withSkillsServer(async ({ baseUrl, runtime, principalSkillsService, runtimeStore, managedAccountId, authHeaders }) => {
    const identity = runtime.getIdentityLinkService().ensureIdentity(buildSkillsIdentityPayload());
    const fixture = createLocalSkillFixture({
      dirName: "demo",
      skillName: "demo-skill",
      description: "demo",
    });
    const accountSkillPath = resolve(
      runtimeStore.getAuthAccount(managedAccountId)?.codexHome ?? "",
      "skills",
      "demo-skill",
    );

    try {
      await principalSkillsService.installFromLocalPath({
        principalId: identity.principalId,
        absolutePath: fixture.skillDir,
      });

      const installedManagedPath = runtimeStore.getPrincipalSkill(PRINCIPAL_ID, "demo-skill")?.managedPath ?? "";
      assert.ok(installedManagedPath);

      const response = await postJson(baseUrl, "/api/identity/reset", buildSkillsIdentityPayload(), authHeaders);
      assert.equal(response.status, 200);

      assert.equal(runtimeStore.getPrincipalSkill(PRINCIPAL_ID, "demo-skill"), null);
      assert.equal(existsSync(installedManagedPath), false);
      assert.equal(existsSync(accountSkillPath), false);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("POST /api/skills/remove 缺少 skillName 时返回 400 INVALID_REQUEST", async () => {
  await withSkillsServer(async ({ baseUrl, authHeaders }) => {
    await assertInvalidRequest(
      postJson(baseUrl, "/api/skills/remove", buildSkillsIdentityPayload(), authHeaders),
      "skill 名称不能为空。",
    );
  });
});

test("POST /api/skills/install 传未知 source.type 时返回 400 INVALID_REQUEST", async () => {
  await withSkillsServer(async ({ baseUrl, authHeaders }) => {
    await assertInvalidRequest(
      postJson(baseUrl, "/api/skills/install", {
        ...buildSkillsIdentityPayload(),
        source: {
          type: "unknown-source",
        },
      }, authHeaders),
      "不支持的 skills 来源类型。",
    );
  });
});

test("POST /api/skills/install 缺少 local-path 必填字段时返回 400 INVALID_REQUEST", async () => {
  await withSkillsServer(async ({ baseUrl, authHeaders }) => {
    await assertInvalidRequest(
      postJson(baseUrl, "/api/skills/install", {
        ...buildSkillsIdentityPayload(),
        source: {
          type: "local-path",
        },
      }, authHeaders),
      "本机路径不能为空。",
    );
  });
});

test("POST /api/skills/list 传空对象时返回 400 INVALID_REQUEST", async () => {
  await withSkillsServer(async ({ baseUrl, authHeaders }) => {
    await assertInvalidRequest(
      postJson(baseUrl, "/api/skills/list", {}, authHeaders),
      "身份请求缺少必要字段。",
    );
  });
});

function listenServer(server: Server): Promise<Server> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
