/**
 * D2 PRD Phase 4 — webfetch-redirected marker pattern (slices 4.1–4.3).
 *
 * Mirrors the Bash redirect marker tests but for the WebFetch deny path
 * in routing.mjs. Default bytes_avoided = 16384 (typical web page body).
 */

import { describe, test, beforeAll, beforeEach, afterAll, afterEach, expect } from "vitest";
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, unlinkSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

import { loadDatabase } from "../../src/db-base.js";


const _hashCanonical = (p: string) => createHash("sha256").update(
  (process.platform === "darwin" || process.platform === "win32") ? p.toLowerCase() : p
).digest("hex").slice(0, 16);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRETOOL_PATH = join(__dirname, "..", "..", "hooks", "pretooluse.mjs");
const POSTTOOL_PATH = join(__dirname, "..", "..", "hooks", "posttooluse.mjs");

interface RawEventRow {
  type: string;
  category: string;
  bytes_avoided: number;
  bytes_returned: number;
  data: string;
}

function readEvents(dbPath: string, sessionId: string, type: string): RawEventRow[] {
  const Database = loadDatabase();
  const raw = new Database(dbPath, { readonly: true });
  try {
    return raw
      .prepare(
        "SELECT type, category, bytes_avoided, bytes_returned, data FROM session_events " +
        "WHERE session_id = ? AND type = ?",
      )
      .all(sessionId, type) as RawEventRow[];
  } finally {
    raw.close();
  }
}

const mcpSentinelDir = process.platform === "win32" ? tmpdir() : "/tmp";
const mcpSentinel = resolve(mcpSentinelDir, `context-mode-mcp-ready-${process.pid}`);

describe("D2 Phase 4 — webfetch-redirected marker pattern", () => {
  let fakeHome: string;
  let fakeProject: string;
  let env: Record<string, string>;
  const sessionId = "redirect-webfetch-test-session";
  let dbPath: string;

  beforeAll(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "ctx-redirect-wf-home-"));
    fakeProject = mkdtempSync(join(tmpdir(), "ctx-redirect-wf-project-"));
    env = {
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      CLAUDE_CONFIG_DIR: join(fakeHome, ".claude"),
      CLAUDE_PROJECT_DIR: fakeProject,
      CLAUDE_SESSION_ID: sessionId,
      CONTEXT_MODE_SESSION_SUFFIX: "",
    };
    // Hooks hash the path AFTER normalizeWorktreePath() (\ → /), so the test
    // must apply the same normalization before SHA — otherwise on Windows the
    // expected hash uses backslashes while the hook uses slashes (#435 pattern).
    const projectHash = _hashCanonical(fakeProject.replace(/\\/g, "/"));
    const dbDir = join(fakeHome, ".claude", "context-mode", "sessions");
    mkdirSync(dbDir, { recursive: true });
    dbPath = join(dbDir, `${projectHash}.db`);
  });

  afterAll(() => {
    try { rmSync(fakeHome, { recursive: true, force: true }); } catch {}
    try { rmSync(fakeProject, { recursive: true, force: true }); } catch {}
  });

  beforeEach(() => {
    writeFileSync(mcpSentinel, String(process.pid));
    const m = resolve(tmpdir(), `context-mode-redirect-${sessionId}.txt`);
    try { unlinkSync(m); } catch {}
  });

  afterEach(() => {
    try { unlinkSync(mcpSentinel); } catch {}
  });

  function runPre(url: string) {
    return spawnSync("node", [PRETOOL_PATH], {
      input: JSON.stringify({
        session_id: sessionId,
        tool_name: "WebFetch",
        tool_input: { url, prompt: "summarize" },
      }),
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, ...env },
    });
  }

  function runPost(toolName: string, toolInput: object, response: string) {
    return spawnSync("node", [POSTTOOL_PATH], {
      input: JSON.stringify({
        session_id: sessionId,
        tool_name: toolName,
        tool_input: toolInput,
        tool_response: response,
      }),
      encoding: "utf-8",
      timeout: 30_000,
      env: { ...process.env, ...env },
    });
  }

  // ─── Slice 4.1 ───────────────────────────────────────────
  test("4.1: PreToolUse does not write a WebFetch redirect marker", () => {
    const r = runPre("https://docs.example.com/long-page");
    assert.equal(r.status, 0, `pretooluse non-zero. stderr: ${r.stderr}`);

    const markerPath = resolve(tmpdir(), `context-mode-redirect-${sessionId}.txt`);
    assert.equal(existsSync(markerPath), false);
  });

  // ─── Slice 4.2 ───────────────────────────────────────────
  test("4.2: PostToolUse does not emit a webfetch-redirected event", () => {
    runPre("https://example.com/article");
    const post = runPost("WebFetch", { url: "https://example.com/article" }, "page");
    assert.equal(post.status, 0, `posttooluse non-zero. stderr: ${post.stderr}`);

    const rows = readEvents(dbPath, sessionId, "webfetch-redirected");
    expect(rows.length).toBe(0);
  });

  // ─── Slice 4.3 ───────────────────────────────────────────
  test("4.3: a long URL still does not write a redirect marker", () => {
    const longUrl = "https://example.com/" + "a".repeat(500);
    runPre(longUrl);
    const markerPath = resolve(tmpdir(), `context-mode-redirect-${sessionId}.txt`);
    assert.equal(existsSync(markerPath), false);
  });
});
