import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "./http-responses.js";

type StaticAssetSurface = "themis" | "platform";

interface StaticAssetBundle {
  assetsRoot: string;
  indexFilePath: string;
  notFoundLabel: string;
}

const webAssetsRoot = resolve(fileURLToPath(new URL("../../apps/web/", import.meta.url)));
const platformAssetsRoot = resolve(fileURLToPath(new URL("../../apps/platform/", import.meta.url)));
const staticAssetBundles: Record<StaticAssetSurface, StaticAssetBundle> = {
  themis: {
    assetsRoot: webAssetsRoot,
    indexFilePath: resolve(webAssetsRoot, "index.html"),
    notFoundLabel: "asset",
  },
  platform: {
    assetsRoot: platformAssetsRoot,
    indexFilePath: resolve(platformAssetsRoot, "index.html"),
    notFoundLabel: "platform asset",
  },
};
const contentTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

export async function serveWebAsset(pathname: string, response: ServerResponse, headOnly = false): Promise<void> {
  return serveSurfaceAsset("themis", pathname, response, headOnly);
}

export async function servePlatformAsset(pathname: string, response: ServerResponse, headOnly = false): Promise<void> {
  return serveSurfaceAsset("platform", pathname, response, headOnly);
}

export function resolveAssetContentType(filePath: string): string | null {
  return contentTypes.get(extname(filePath)) ?? null;
}

async function serveSurfaceAsset(
  surface: StaticAssetSurface,
  pathname: string,
  response: ServerResponse,
  headOnly: boolean,
): Promise<void> {
  const bundle = staticAssetBundles[surface];
  const asset = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = resolve(bundle.assetsRoot, asset);
  const contentType = resolveAssetContentType(filePath);

  if (!contentType || (!filePath.startsWith(`${bundle.assetsRoot}${sep}`) && filePath !== bundle.indexFilePath)) {
    writeAssetNotFound(response, pathname, bundle.notFoundLabel, headOnly);
    return;
  }

  let content: Buffer;

  try {
    content = await readFile(filePath);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

    if (code === "ENOENT" || code === "ENOTDIR") {
      writeAssetNotFound(response, pathname, bundle.notFoundLabel, headOnly);
      return;
    }

    throw error;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", contentType);
  response.setHeader("Cache-Control", "no-store");

  if (headOnly) {
    response.end();
    return;
  }

  response.end(content);
}

function writeAssetNotFound(
  response: ServerResponse,
  pathname: string,
  label: string,
  headOnly: boolean,
): void {
  writeJson(response, 404, {
    error: {
      code: "NOT_FOUND",
      message: `Unknown ${label}: ${pathname}`,
    },
  }, headOnly);
}
