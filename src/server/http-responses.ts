import type { ServerResponse } from "node:http";

export function writeJson(response: ServerResponse, statusCode: number, body: unknown, headOnly = false): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  if (headOnly) {
    response.end();
    return;
  }

  response.end(JSON.stringify(body, null, 2));
}

export function writeHtml(response: ServerResponse, statusCode: number, body: string, headOnly = false): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");

  if (headOnly) {
    response.end();
    return;
  }

  response.end(body);
}

export function writeRedirect(response: ServerResponse, location: string, statusCode = 302): void {
  response.statusCode = statusCode;
  response.setHeader("Location", location);
  response.setHeader("Cache-Control", "no-store");
  response.end();
}

export function writeNdjson(response: ServerResponse, body: unknown): void {
  response.write(`${JSON.stringify(body)}\n`);
}

export function safeWriteNdjson(response: ServerResponse, body: unknown, streamClosed: boolean): void {
  if (streamClosed || response.destroyed || response.writableEnded) {
    return;
  }

  writeNdjson(response, body);
}
