// Dependencies live outside the submission. No node_modules or package cache is created here.
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const root = resolve(import.meta.dirname, "..");
const home = process.env.DOCKET_TOOLCHAIN || join(tmpdir(), "docket-toolchain");
export const modules = join(home, "node_modules");
const command = process.argv[2];
mkdirSync(home, { recursive: true });
function run(exe, args) {
  const r = spawnSync(exe, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, DOCKET_MODULES: modules },
  });
  process.exitCode = r.status ?? 1;
  return r;
}
if (command === "install") {
  copyFileSync(join(root, "package.json"), join(home, "package.json"));
  if (existsSync(join(root, "package-lock.json")))
    copyFileSync(
      join(root, "package-lock.json"),
      join(home, "package-lock.json"),
    );
  run("npm", [
    existsSync(join(home, "package-lock.json")) ? "ci" : "install",
    "--prefix",
    home,
    "--cache",
    join(home, "cache"),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  if (!process.exitCode)
    copyFileSync(
      join(home, "package-lock.json"),
      join(root, "package-lock.json"),
    );
} else if (command === "typecheck") {
  const settings = JSON.parse(
    readFileSync(join(root, "tsconfig.json"), "utf8"),
  );
  settings.compilerOptions.baseUrl = root;
  settings.compilerOptions.paths = {
    react: [join(modules, "@types/react")],
    "react/*": [join(modules, "@types/react/*")],
    "react-dom/*": [join(modules, "@types/react-dom/*")],
    qrcode: [join(modules, "@types/qrcode")],
    viem: [join(modules, "viem")],
    "viem/*": [join(modules, "viem/*")],
    "@walletconnect/ethereum-provider": [
      join(modules, "@walletconnect/ethereum-provider"),
    ],
  };
  settings.include = [join(root, "src")];
  writeFileSync(join(home, "tsconfig.json"), JSON.stringify(settings));
  run(process.execPath, [
    join(modules, "typescript/bin/tsc"),
    "--noEmit",
    "-p",
    join(home, "tsconfig.json"),
  ]);
} else if (command === "build" || command === "preview") {
  const vite = await import(
    pathToFileURL(join(modules, "vite/dist/node/index.js")).href
  );
  const aliases = [
    "react",
    "react-dom",
    "viem",
    "@walletconnect/ethereum-provider",
    "qrcode",
  ].map((name) => ({
    find: new RegExp("^" + name + "(?=/|$)"),
    replacement: join(modules, name),
  }));
  const config = {
    root,
    configFile: false,
    cacheDir: join(home, "vite-cache"),
    base: "./",
    resolve: { alias: aliases, dedupe: ["react", "react-dom"] },
    esbuild: { jsx: "automatic" },
    build: { target: "es2022", chunkSizeWarningLimit: 650, sourcemap: false },
    preview: { host: "127.0.0.1", port: 4173 },
  };
  if (command === "build") await vite.build(config);
  else {
    const server = await vite.preview(config);
    server.printUrls();
  }
} else if (command === "test") {
  run(process.execPath, [join(root, "scripts/validate.mjs")]);
} else {
  console.error("Use install, build, typecheck, preview or test");
  process.exitCode = 1;
}
