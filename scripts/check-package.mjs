import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Exercise what npm users actually install, outside the source checkout.
const root = mkdtempSync(join(tmpdir(), "jeonseogu-package-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const run = (args) => execFileSync(npm, args, {
  encoding: "utf8", stdio: ["ignore", "pipe", "inherit"],
  shell: process.platform === "win32", timeout: 180_000,
});

try {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  assert.equal(pkg.version, lock.version, "Update package-lock.json with the version");
  assert.equal(pkg.version, lock.packages[""].version);
  const [pack] = JSON.parse(run(["pack", "--json", "--pack-destination", root]));
  const paths = pack.files.map(({ path }) => path);
  for (const required of ["package.json", "README.md", "LICENSE", "personas/jeonseogu.md", ...Object.values(pkg.bin)]) {
    assert.ok(paths.includes(required), `Missing package file: ${required}`);
  }
  for (const path of paths) {
    assert.match(path, /^(package\.json|README\.md|LICENSE|dist\/.+\.(js|d\.ts)|personas\/.+\.md)$/,
      `Unexpected published file: ${path}`);
  }
  const archive = resolve(root, pack.filename);
  run(["install", "--prefix", root, "--omit=dev", "--no-audit", "--no-fund", "--package-lock=false", archive]);
  const installed = join(root, "node_modules", pkg.name);
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.equal(manifest.version, pkg.version);
  for (const name of Object.keys(manifest.bin)) {
    const executable = join(root, "node_modules", ".bin", name + (process.platform === "win32" ? ".cmd" : ""));
    const output = execFileSync(executable, ["--help"], {
      cwd: root, encoding: "utf8", timeout: 30_000,
      shell: process.platform === "win32",
      env: { ...process.env, JEONSEOGU_NO_UPDATE: "1", PI_CODING_AGENT_DIR: join(root, "agent") },
    });
    assert.match(output, /usage:/i, `${name} must start without API credentials`);
  }
  console.log(`Verified ${pkg.name}@${pkg.version}: ${paths.length} files, clean production install, both CLI entry points.`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
