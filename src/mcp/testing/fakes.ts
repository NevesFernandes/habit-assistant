// Test doubles for the MCP tests (Node only, not part of the Worker): an in-memory Drive
// file with the same version check as drive.ts, and a JSON-RPC caller for the server.
import assert from "node:assert/strict";
import type { AppData } from "../../types/models.ts";
import { DriveConflictError, type DriveFileRef } from "../drive.ts";
import type { FileStore, LoadedFile } from "../persist.ts";
import { handleMcpRequest, type McpDeps } from "../server.ts";

export interface MemoryStore extends FileStore {
  /** The file as stored, parsed fresh. */
  file(): AppData;
  version(): number;
  /** Simulates the app saving between our read and our write, `times` times in a row. */
  interfere(times: number, change: (data: AppData) => AppData): void;
}

/** Same round trip as Drive: JSON in, JSON out, a new modifiedTime on every save. */
export function memoryStore(initial: AppData | (() => Promise<AppData>)): MemoryStore {
  let text = typeof initial === "function" ? "" : JSON.stringify(initial);
  let version = 1;
  let pending: { times: number; change: (data: AppData) => AppData } | undefined;
  const ref = (): DriveFileRef => ({ fileId: "file", modifiedTime: String(version) });
  return {
    async load(): Promise<LoadedFile> {
      if (typeof initial === "function") return { ref: ref(), data: await initial() };
      return { ref: ref(), data: JSON.parse(text) };
    },
    async save(saved, data) {
      if (pending && pending.times > 0) {
        pending.times--;
        text = JSON.stringify(pending.change(JSON.parse(text)));
        version++;
      }
      if (saved.modifiedTime !== String(version)) throw new DriveConflictError();
      text = JSON.stringify(data);
      version++;
      return ref();
    },
    file: () => JSON.parse(text),
    version: () => version,
    interfere(times, change) {
      pending = { times, change };
    },
  };
}

export async function rpc(deps: McpDeps, method: string, params: unknown = {}): Promise<{ result?: any; error?: any }> {
  const res = await handleMcpRequest(
    new Request("http://localhost/mcp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }),
    deps,
  );
  assert.equal(res.status, 200, `${method}: HTTP ${res.status} ${await res.clone().text()}`);
  return res.json();
}

export async function callTool(deps: McpDeps, name: string, args: Record<string, unknown>): Promise<{ isError: boolean; body: any }> {
  const { result, error } = await rpc(deps, "tools/call", { name, arguments: args });
  assert.equal(error, undefined, `${name}: ${JSON.stringify(error)}`);
  return { isError: result.isError === true, body: JSON.parse(result.content[0].text) };
}
