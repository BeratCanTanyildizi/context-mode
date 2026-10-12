import { createServer, type AddressInfo } from "node:http";
import { describe, expect, test } from "vitest";
import { PolyglotExecutor } from "../../src/executor.js";
import { detectRuntimes } from "../../src/runtime.js";
import {
  NETWORK_DENY_PROFILE,
  wrapWithNetworkDeny,
} from "../../src/network-guard.js";

const runtimes = detectRuntimes();
const executor = new PolyglotExecutor({ runtimes });

describe("wrapWithNetworkDeny", () => {
  test("wraps on darwin", () => {
    expect(wrapWithNetworkDeny(["node", "a.js"], "darwin", {})).toEqual([
      "/usr/bin/sandbox-exec",
      "-p",
      NETWORK_DENY_PROFILE,
      "node",
      "a.js",
    ]);
  });

  test("passes through when CONTEXT_MODE_ALLOW_NETWORK=1", () => {
    const cmd = ["node", "a.js"];
    expect(
      wrapWithNetworkDeny(cmd, "darwin", { CONTEXT_MODE_ALLOW_NETWORK: "1" }),
    ).toEqual(cmd);
  });

  test("throws on linux without override", () => {
    expect(() => wrapWithNetworkDeny(["node", "a.js"], "linux", {})).toThrow(
      /network isolation unsupported/,
    );
  });
});

describe("sandboxed execution", () => {
  test.skipIf(process.platform !== "darwin")("blocks https", async () => {
    const r = await executor.execute({
      language: "javascript",
      timeout: 8000,
      code: `try { await fetch("https://example.com"); console.log("OK"); } catch (e) { console.log(String(e)); }`,
    });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(out.includes("fetch failed") || r.exitCode !== 0).toBe(true);
  });

  test.skipIf(process.platform !== "darwin")("blocks dns lookup", async () => {
    const r = await executor.execute({
      language: "javascript",
      timeout: 8000,
      code: `require("dns").lookup("example.com", e => console.log(e ? "DENIED" : "OK"))`,
    });
    expect(r.stdout).toContain("DENIED");
  });

  test.skipIf(process.platform !== "darwin")("blocks nested curl", async () => {
    const r = await executor.execute({
      language: "shell",
      timeout: 8000,
      code: `sh -c "curl -s -m 3 https://example.com >/dev/null && echo OK || echo DENIED"`,
    });
    expect(r.stdout).toContain("DENIED");
  });

  test.skipIf(process.platform !== "darwin")("allows 127.0.0.1", async () => {
    const server = createServer((_req, res) => {
      res.end("pong");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const port = (server.address() as AddressInfo).port;
    try {
      const r = await executor.execute({
        language: "javascript",
        timeout: 8000,
        code: `const res = await fetch("http://127.0.0.1:${port}"); console.log(await res.text());`,
      });
      expect(r.stdout).toContain("pong");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  test.skipIf(process.platform !== "darwin")("still runs shell and python", async () => {
    const shell = await executor.execute({
      language: "shell",
      timeout: 8000,
      code: "echo hi",
    });
    const python = await executor.execute({
      language: "python",
      timeout: 8000,
      code: "print(1+1)",
    });
    expect(shell.stdout).toContain("hi");
    expect(python.stdout).toContain("2");
  });
});
