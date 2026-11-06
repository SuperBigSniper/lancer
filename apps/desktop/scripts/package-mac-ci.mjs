import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withGithubDownloadRetry } from "./github-download-retry.mjs";

// CI has no persistent macOS certificate, and `run-electron-builder.mjs`
// deliberately refuses ad-hoc signing for real updates. This runner is the
// explicit CI-only counterpart: it uses the checked-in `mac.identity: null`
// configuration and produces artifacts that are neither signed nor notarized.
// Do not point installers or update feeds at its output.

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(desktopDir, "..", "..");
const cacheRoot = path.join(repoDir, ".cache");

// Signing intent comes from `electron-builder.yml` (`mac.identity: null`,
// `mac.notarize: false`), which `pnpm verify:release-config` proves before CI
// packs. Overriding config here through `-c.…` flags would only add a second
// source of truth.
export const CI_ELECTRON_BUILDER_ARGS = Object.freeze(["--mac", "--publish", "never"]);

function createUnsignedPackagingEnv() {
  const electronBuilderCache =
    process.env.ELECTRON_BUILDER_CACHE ?? path.join(cacheRoot, "electron-builder");
  mkdirSync(electronBuilderCache, { recursive: true });
  return {
    ...process.env,
    ELECTRON_BUILDER_CACHE: electronBuilderCache,
    // Never let a stray keychain identity change what CI produced.
    CSC_IDENTITY_AUTO_DISCOVERY: "false",
  };
}

function spawnElectronBuilder(electronBuilderArgs) {
  const result = spawnSync("pnpm", ["exec", "electron-builder", ...electronBuilderArgs], {
    cwd: desktopDir,
    encoding: "utf8",
    stdio: ["inherit", "pipe", "pipe"],
    env: createUnsignedPackagingEnv(),
  });
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}\n${result.error?.message ?? ""}`;
  return {
    ok: result.status === 0 && !result.error,
    status: result.status ?? (result.signal ? 1 : 0),
    output,
    error: result.error,
  };
}

export async function runUnsignedMacPackage(electronBuilderArgs = CI_ELECTRON_BUILDER_ARGS) {
  if (process.platform !== "darwin") {
    throw new Error("Unsigned macOS packaging only runs on macOS.");
  }
  const result = await withGithubDownloadRetry(() =>
    spawnElectronBuilder([...electronBuilderArgs]),
  );
  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await runUnsignedMacPackage());
}
