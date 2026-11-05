import { config as loadEnv } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

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
  return process.env[name] === "true";
}
