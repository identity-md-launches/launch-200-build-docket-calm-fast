import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const base = process.env.DOCKET_TOOLCHAIN || join(tmpdir(), "docket-toolchain");
const lock = JSON.parse(
  readFileSync(new URL("../package-lock.json", import.meta.url)),
);
const groups = new Map();
for (const [path, info] of Object.entries(lock.packages)) {
  if (!path || info.dev || !existsSync(join(base, path, "package.json")))
    continue;
  const pkg = JSON.parse(readFileSync(join(base, path, "package.json")));
  const licenses = readdirSync(join(base, path)).filter((x) =>
    /^(license|licence|copying|notice)(\.|$)/i.test(x),
  );
  const texts = licenses
    .map((x) => readFileSync(join(base, path, x), "utf8"))
    .join("\n");
  const key =
    texts ||
    `License identifier: ${pkg.license || info.license || "See upstream package"}\n`;
  const names = groups.get(key) || [];
  names.push(`${pkg.name}@${pkg.version}`);
  groups.set(key, names);
}
let out =
  "Frontend dependency license notices\nGenerated from the locked production dependency tree.\n\n";
for (const [license, names] of groups)
  out += names.join(", ") + "\n" + "=".repeat(72) + "\n" + license + "\n\n";
writeFileSync(
  new URL("../public/dependency-licenses.txt", import.meta.url),
  out,
);
console.log(`${groups.size} distinct notices, ${Buffer.byteLength(out)} bytes`);
