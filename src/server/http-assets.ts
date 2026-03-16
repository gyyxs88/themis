import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { writeJson } from "./http-responses.js";

const assetsRoot = resolve(fileURLToPath(new URL("../../apps/web/", import.meta.url)));
const indexFilePath = resolve(assetsRoot, "index.html");
const contentTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
]);

export async function serveWebAsset(pathname: string, response: ServerResponse, headOnly = false): Promise<void> {
  const asset = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = resolve(assetsRoot, asset);
  const contentType = resolveAssetContentType(filePath);

  if (!contentType || (!filePath.startsWith(`${assetsRoot}${sep}`) && filePath !== indexFilePath)) {
    writeJson(response, 404, {
      error: {
        code: "NOT_FOUND",
        message: `Unknown asset: ${pathname}`,
      },
    }, headOnly);
    return;
  }

  let content: Buffer;

  try {
    content = await readFile(filePath);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";

    if (code === "ENOENT" || code === "ENOTDIR") {
      writeJson(response, 404, {
        error: {
          code: "NOT_FOUND",
          message: `Unknown asset: ${pathname}`,
        },
      }, headOnly);
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

export function resolveAssetContentType(filePath: string): string | null {
  return contentTypes.get(extname(filePath)) ?? null;
}
