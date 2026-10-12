/**
 * Local insert stays local. A platform.json on disk must not cause a fetch.
 */

import { describe, test, beforeEach, afterEach, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { SessionDB } from "../../src/session/db.js";
import { attributeAndInsertEvents } from "../../hooks/session-loaders.mjs";

function writePlatformConfig(fakeHome: string): void {
  const cfgFile = process.platform === "win32"
    ? join(process.env.APPDATA ?? join(fakeHome, "AppData", "Roaming"), "context-mode", "platform.json")
    : join(fakeHome, ".context-mode", "platform.json");
  mkdirSync(dirname(cfgFile), { recursive: true });
  writeFileSync(cfgFile, JSON.stringify({
    api_key: "ctxm_parity_gate",
    platform_url: "https://capture.local/api/v1",
  }));
}

describe("local session insert does not leave the machine", () => {
  let fakeHome: string;
  let origHome: string | undefined;
  let origAppData: string | undefined;
  let origFetch: typeof fetch;
  let calls: string[];

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "seed-parity-home-"));
    origHome = process.env.HOME;
    origAppData = process.env.APPDATA;
    process.env.HOME = fakeHome;
    process.env.APPDATA = join(fakeHome, "AppData", "Roaming");
    writePlatformConfig(fakeHome);
    calls = [];
    origFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown) => {
      calls.push(String(url));
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origHome !== undefined) process.env.HOME = origHome;
    else delete process.env.HOME;
    if (origAppData !== undefined) process.env.APPDATA = origAppData;
    else delete process.env.APPDATA;
    rmSync(fakeHome, { recursive: true, force: true });
  });

  test("attributeAndInsertEvents writes the local db and does not fetch", async () => {
    const db = new SessionDB({ dbPath: join(fakeHome, "test.db") });
    const sessionId = "local-only-" + Date.now();
    db.ensureSession(sessionId, fakeHome);
    const events = [
      { type: "tool_use", category: "edit", data: "Edit('src/foo.ts')", priority: 2 },
      { type: "error_tool", category: "error", data: "ENOENT: no such file", priority: 1 },
    ];
    attributeAndInsertEvents(
      db,
      sessionId,
      events,
      { workspace_roots: [fakeHome] },
      fakeHome,
      "PostToolUse",
      (evs: { type: string }[]) => evs.map(() => ({ projectDir: fakeHome, source: "input_cwd", confidence: 1 })),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toEqual([]);
    expect(db.getEvents(sessionId, 20)).toHaveLength(events.length);
    db.close?.();
  });
});
