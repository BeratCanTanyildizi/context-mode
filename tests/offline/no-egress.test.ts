import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

export const SHIPPED_GLOBS = [
  "src/**/*.ts",
  "hooks/**/*.mjs",
  "bin/**/*.mjs",
  "start.mjs",
  "server.bundle.mjs",
  "cli.bundle.mjs",
  "scripts/postinstall.mjs",
];

export const EGRESS_PATTERNS: Record<string, RegExp> = {
  platformBridge: /platform-bridge|platform\.json|maybeForward/,
  npmRegistry: /registry\.npmjs\.org/,
  hostedSite: /context-mode\.com/,
  githubPull: /git clone|api\.github\.com|raw\.githubusercontent\.com(?!\/ajv-validator)/,
  runtimeInstall: /\bnpm(\.cmd)?\b["'`,\s]+(install|rebuild|i)\b|npx tsc/,
  fetchTool: /ctx_fetch_and_index/,
  fullNetwork: /[Ff]ull network access/,
};

const ROOT = join(import.meta.dirname, "..", "..");

const EXACT = new Set(
  SHIPPED_GLOBS.filter((glob) => !glob.includes("*")),
);

function globCovers(rel: string): boolean {
  if (EXACT.has(rel)) return true;
  if (rel.startsWith("src/") && rel.endsWith(".ts")) return true;
  if (rel.startsWith("hooks/") && rel.endsWith(".mjs")) return true;
  if (rel.startsWith("bin/") && rel.endsWith(".mjs")) return true;
  return false;
}

export function shippedFiles(root = ROOT): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      const rel = relative(root, abs);
      if (globCovers(rel)) found.push(rel);
    }
  };
  walk(root);
  for (const exact of EXACT) {
    if (!found.includes(exact) && statSync(join(root, exact), { throwIfNoEntry: false })?.isFile()) {
      found.push(exact);
    }
  }
  return found.sort();
}

export function patternHits(root: string, files: string[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const rel of files) {
    const lines = readFileSync(join(root, rel), "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      pattern.lastIndex = 0;
      if (pattern.test(lines[i])) hits.push(`${rel}:${i + 1}`);
    }
  }
  return hits;
}

describe("shipped files send nothing off the machine", () => {
  const files = shippedFiles();

  for (const [name, pattern] of Object.entries(EGRESS_PATTERNS)) {
    it(name, () => {
      const hits = patternHits(ROOT, files, pattern);
      expect(hits, hits.join("\n")).toEqual([]);
    });
  }
});
