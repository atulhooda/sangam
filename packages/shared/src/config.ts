import { config as loadEnv } from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The monorepo root: the nearest folder above the current directory whose
 * package.json declares workspaces. Works from the repo root (scripts) and
 * from apps/web (next dev), and doesn't depend on import.meta.url, which a
 * bundler may rewrite.
 */
function findRepoRoot(): string {
  let dir = process.cwd();
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, "utf8")) as { workspaces?: unknown }).workspaces) return dir;
      } catch {
        /* keep walking */
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return process.cwd();
    dir = parent;
  }
}

export const REPO_ROOT = findRepoRoot();

/**
 * Where the JSON stores live (settlements, budget ledger, identities, …).
 * SANGAM_DATA_DIR points it at a persistent volume (e.g. /data on Railway).
 * On Vercel the deployment filesystem is read-only, so serverless instances
 * fall back to /tmp — data survives there between requests on the same
 * instance but resets on cold starts.
 */
export const DATA_DIR =
  process.env.SANGAM_DATA_DIR?.trim() || (process.env.VERCEL ? "/tmp/sangam-data" : path.join(REPO_ROOT, "data"));

loadEnv({ path: path.join(REPO_ROOT, ".env"), quiet: true });

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var ${name}. Copy .env.example to .env and fill it in.`);
  return value;
}

export function envOr(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

/** Dev-only switches, e.g. OG_MOCK=true. Every mock is labelled in the UI and logs. */
export function flag(name: string): boolean {
  return process.env[name]?.trim() === "true";
}

export function hasEnv(...names: string[]): boolean {
  return names.every((n) => Boolean(process.env[n]));
}

/**
 * Which parts of the rail are mocked right now. `true` means mocked.
 * Each one goes live independently by changing .env, so the demo can move
 * from simulation to real one service at a time.
 */
export function mocks() {
  return {
    /** SKIP_CHAIN_VERIFY=true trusts settlement notices without the Mirror Node check. */
    chainVerify: flag("SKIP_CHAIN_VERIFY"),
    /** OG_MOCK=true uses a local rule instead of 0G Compute. */
    og: flag("OG_MOCK"),
    /** PSP_MODE=mock returns a fake UPI payout reference. */
    psp: envOr("PSP_MODE", "mock") === "mock",
    /** ENS_OFFLINE=true reads merchants from data/merchants.local.json. */
    ens: flag("ENS_OFFLINE"),
    /** No HCS_TOPIC_ID means receipts aren't written. */
    hcs: !hasEnv("HCS_TOPIC_ID", "OPERATOR_ACCOUNT_ID", "OPERATOR_PRIVATE_KEY"),
  };
}

export type Mocks = ReturnType<typeof mocks>;
