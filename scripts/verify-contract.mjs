import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const input = readFileSync(
  new URL("../public/compiler-input.json", import.meta.url),
  "utf8",
);
const source = readFileSync(
  new URL("../contract/Docket.sol", import.meta.url),
  "utf8",
);
assert.equal(JSON.parse(input).sources["src/Docket.sol"].content, source);
const compiler = process.env.SOLC || join(homedir(), ".svm/0.8.26/solc-0.8.26");
const version = spawnSync(compiler, ["--version"], { encoding: "utf8" });
assert.match(version.stdout, /0\.8\.26\+commit\.8a97fa7a/);
const r = spawnSync(compiler, ["--standard-json"], { input, encoding: "utf8" });
assert.equal(r.status, 0);
const output = JSON.parse(r.stdout);
assert(!output.errors?.some((e) => e.severity === "error"));
const contract = output.contracts["src/Docket.sol"].Docket;
const artifact = JSON.parse(
  readFileSync(new URL("../src/docket.json", import.meta.url), "utf8"),
);
assert.deepEqual(artifact.abi, contract.abi);
assert.equal(artifact.bytecode, "0x" + contract.evm.bytecode.object);
assert.equal(
  artifact.deployedBytecode,
  "0x" + contract.evm.deployedBytecode.object,
);
console.log(
  "Solidity 0.8.26: exact ABI, creation and runtime bytecode reproduced.",
);
console.log(
  "creation SHA-256:",
  createHash("sha256")
    .update(Buffer.from(artifact.bytecode.slice(2), "hex"))
    .digest("hex"),
);
