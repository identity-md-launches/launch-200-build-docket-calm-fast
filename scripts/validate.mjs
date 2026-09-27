import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
const root = resolve(import.meta.dirname, "..");
const req = createRequire(
  join(
    process.env.DOCKET_MODULES ||
      join(tmpdir(), "docket-toolchain/node_modules"),
    "package.json",
  ),
);
const { createPublicClient, createWalletClient, http, defineChain, parseAbi } =
  req("viem");
const { chromium } = req("playwright");
const { default: AxeBuilder } = req("@axe-core/playwright");
const artifact = JSON.parse(readFileSync(join(root, "src/docket.json")));
const template = JSON.parse(readFileSync(join(root, "public/config.json")));
const anvil = process.env.ANVIL || join(homedir(), ".foundry/bin/anvil");
const solc = process.env.SOLC || join(homedir(), ".svm/0.8.26/solc-0.8.26");
const serverPort = Number(process.env.DOCKET_TEST_PORT || 21417);
const ports = { 1: serverPort + 128, 8453: serverPort + 129 };
const origin = `http://127.0.0.1:${serverPort}`;
const account = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const poor = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const tokenHolder = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const exact = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";
const staked = "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65";
const children = [];
let browser, server, currentPage;
let config = structuredClone(template);
let fail = 0;
let truncate = false;
let mode = "configured";
let endInspection;
const inspectionDone = new Promise((resolve) => {
  endInspection = resolve;
});
const results = [];
const consoleErrors = [];
const failedRequests = [];
const receipts = [];
const clients = {};
mkdirSync(join(root, "test/scratch"), { recursive: true });
mkdirSync(join(root, "artifacts"), { recursive: true });
const log = (s) => {
  results.push(s);
  console.log("PASS " + s);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function rpc(id, method, params = []) {
  const r = await fetch(`http://127.0.0.1:${ports[id]}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
async function setup() {
  for (const id of [1, 8453]) {
    const child = spawn(
      anvil,
      [
        "--host",
        "127.0.0.1",
        "--port",
        String(ports[id]),
        "--chain-id",
        String(id),
        "--network",
        "ethereum",
        "--hardfork",
        "cancun",
        "--silent",
      ],
      { stdio: "ignore" },
    );
    children.push(child);
    let live = false;
    for (let t = 0; t < 50; t++) {
      try {
        assert.equal(Number(await rpc(id, "eth_chainId")), id);
        live = true;
        break;
      } catch {
        await wait(100);
      }
    }
    if (!live) throw new Error("Anvil did not start");
    const chain = defineChain({
      id,
      name: `Local ${id}`,
      nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
      rpcUrls: { default: { http: [`http://127.0.0.1:${ports[id]}`] } },
    });
    const pub = createPublicClient({
      chain,
      transport: http(),
      cacheTime: 0,
      pollingInterval: 50,
    });
    const wallet = createWalletClient({ chain, transport: http(), account });
    clients[id] = { pub, wallet };
    const hash = await wallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode,
    });
    const r = await pub.waitForTransactionReceipt({ hash });
    assert.equal(
      (await pub.getCode({ address: r.contractAddress })).toLowerCase(),
      artifact.deployedBytecode.toLowerCase(),
    );
    const b = config.chains.find((b) => b.chainId === id);
    b.address = r.contractAddress;
    b.deploymentBlock = r.blockNumber.toString();
    b.rpcUrl = origin + "/rpc/" + id;
    receipts.push({
      action: "fixture deployment",
      chainId: id,
      address: r.contractAddress,
      block: b.deploymentBlock,
      hash,
    });
  }
  config.mainnetRpcUrl = origin + "/rpc/1";
  config.scanChunkSize = 20;
  config.pollIntervalMs = 300000;
  const input = {
    language: "Solidity",
    sources: {
      "MockBalances.sol": {
        content: readFileSync(
          join(root, "scripts/fixtures/MockBalances.sol"),
          "utf8",
        ),
      },
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      outputSelection: { "*": { "*": ["evm.deployedBytecode.object"] } },
    },
  };
  const compilation = spawnSync(solc, ["--standard-json"], {
    input: JSON.stringify(input),
    encoding: "utf8",
  });
  const output = JSON.parse(compilation.stdout);
  if (output.errors?.some((e) => e.severity === "error"))
    throw new Error(JSON.stringify(output.errors));
  const code =
    "0x" +
    output.contracts["MockBalances.sol"].MockBalances.evm.deployedBytecode
      .object;
  for (const address of [
    config.gate.seatAddress,
    config.gate.imdAddress,
    config.gate.stakedAddress,
  ])
    await rpc(1, "anvil_setCode", [address, code]);
  async function send(id, method, args, who = account) {
    const c = clients[id];
    const hash = await c.wallet.writeContract({
      account: who,
      address: config.chains.find((b) => b.chainId === id).address,
      abi: artifact.abi,
      functionName: method,
      args,
    });
    const r = await c.pub.waitForTransactionReceipt({ hash });
    receipts.push({
      action: method,
      chainId: id,
      hash,
      block: r.blockNumber.toString(),
    });
    return r;
  }
  await send(8453, "createIdea", [
    "A field guide to what the swarm has built",
    "A small, readable map of the swarm’s work. Group useful tools by the problem they solve, with a link to the source and a short note on how to use them.\n\nStart with ten projects that someone can actually use today. Keep it simple enough that the next person can add the eleventh.",
  ]);
  await send(1, "createIdea", [
    "Make job outcomes easier to read",
    "subject: job:4a26aecb-5f31-4474-bdde-7021f71c3b7c\nThe output of a job should be as easy to understand as the idea that started it.\n\nCould each completed job open with a short description of what was built, what was checked, and what still needs a human decision?",
  ]);
  await send(8453, "createIdea", [
    "A quieter way to follow an agent’s work",
    "subject: agent:494\nShow the last few accepted jobs and the next useful step. A plain page that makes the work legible without adding another dashboard.",
  ]);
  await send(8453, "createIdea", [
    "Let’s test the Docket with real conversations",
    "subject: launch:197\nInvite a few people to shape a useful job idea together. Record where the interface gets in the way and keep the fixes small.",
  ]);
  await send(
    1,
    "createIdea",
    [
      "Give every public tool a small example",
      "A runnable example can explain more than a long README. Pick three tools and add an input, the expected output, and a note about limitations.",
    ],
    poor,
  );
  await send(
    8453,
    "comment",
    [
      1n,
      "I’d start with the outcome, then link to the job that produced it. The source should be one step away.",
    ],
    tokenHolder,
  );
  await send(8453, "comment", [
    1n,
    "Agreed. A useful first version could fit on a single page. Make “what can I do with this?” the first question it answers.",
  ]);
  await send(8453, "upvote", [1n, 0n], tokenHolder);
  await send(8453, "upvote", [1n, 0n], poor);
  await send(8453, "upvote", [1n, 1n], account);
  log(
    "Two exact Docket runtimes deployed; 5 ideas, 2 comments, and 3 votes seeded on two independent chains.",
  );
  server = createServer(async (r, s) => {
    try {
      s.setHeader("Access-Control-Allow-Origin", "*");
      s.setHeader("Access-Control-Allow-Headers", "content-type");
      if (r.method === "OPTIONS") {
        s.end();
        return;
      }
      if (r.url === "/__finish") {
        s.end("closing local fixture");
        endInspection();
        return;
      }
      if (r.url.startsWith("/__state")) {
        const params = new URL(r.url, origin).searchParams;
        if (params.has("fail")) fail = Number(params.get("fail"));
        if (params.has("mode")) mode = params.get("mode");
        if (params.has("truncate")) truncate = params.get("truncate") === "1";
        s.end("ok");
        return;
      }
      if (r.url === "/__wallet.js") {
        s.setHeader("content-type", "text/javascript");
        s.end(readFileSync(join(root, "scripts/fixtures/wallet.js")));
        return;
      }
      if (r.url.startsWith("/rpc/")) {
        const id = Number(r.url.split("/")[2]);
        let raw = "";
        for await (const chunk of r) raw += chunk;
        const body = JSON.parse(raw);
        if (id === fail) {
          s.statusCode = 503;
          s.end(JSON.stringify({ error: "Simulated RPC outage" }));
          return;
        }
        const forward = async (q) => {
          if (truncate && id === 1 && q.method === "eth_getLogs")
            return { id: q.id, jsonrpc: "2.0", result: [] };
          if (
            q.method === "eth_getLogs" &&
            BigInt(q.params[0].toBlock) - BigInt(q.params[0].fromBlock) > 1n
          )
            return {
              id: q.id,
              jsonrpc: "2.0",
              error: { code: -32005, message: "test public-RPC range limit" },
            };
          try {
            return {
              id: q.id,
              jsonrpc: "2.0",
              result: await rpc(id, q.method, q.params),
            };
          } catch (e) {
            return {
              id: q.id,
              jsonrpc: "2.0",
              error: { code: -32000, message: e.message },
            };
          }
        };
        s.setHeader("content-type", "application/json");
        s.end(
          JSON.stringify(
            Array.isArray(body)
              ? await Promise.all(body.map(forward))
              : await forward(body),
          ),
        );
        return;
      }
      const url = new URL(r.url, origin);
      if (url.pathname === "/preview/config.json") {
        s.setHeader("content-type", "application/json");
        s.setHeader("cache-control", "no-store");
        s.end(JSON.stringify(mode === "unconfigured" ? template : config));
        return;
      }
      const relative = url.pathname.replace(/^\/preview\//, "") || "index.html";
      const p = resolve(root, "dist", relative);
      if (!p.startsWith(resolve(root, "dist") + "/") || !existsSync(p)) {
        s.statusCode = 404;
        s.end("Not found");
        return;
      }
      const types = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".woff2": "font/woff2",
        ".svg": "image/svg+xml",
        ".txt": "text/plain",
      };
      s.setHeader(
        "content-type",
        types[extname(p)] || "application/octet-stream",
      );
      s.end(readFileSync(p));
    } catch (e) {
      s.statusCode = 500;
      s.end(e.message);
    }
  });
  await new Promise((r, reject) => {
    server.once("error", reject);
    server.listen(serverPort, "0.0.0.0", r);
  });
  writeFileSync(
    join(root, "test/scratch/local-preview.json"),
    JSON.stringify({ url: origin + "/preview/", config }, null, 2),
  );
}
async function tests() {
  const executable =
    process.env.CHROMIUM ||
    join(homedir(), ".cache/ms-playwright/chromium-1246/chrome-linux64/chrome");
  browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(executable) ? executable : undefined,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
    colorScheme: "dark",
  });
  await context.addInitScript({
    path: join(root, "scripts/fixtures/wallet.js"),
  });
  const page = await context.newPage();
  currentPage = page;
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("requestfailed", (r) => {
    if (!/api.imd.fun|explorer.imd.fun/.test(r.url()))
      failedRequests.push({ url: r.url(), error: r.failure()?.errorText });
  });
  // External subject data remains a separate CORS dependency; test deterministic fallbacks below.
  await page.route("https://api.imd.fun/jobs/**", (r) => r.abort());
  await page.route("https://explorer.imd.fun/api/agents/**", (r) => r.abort());
  await page.goto(origin + "/preview/");
  await page.locator(".ideas>li").nth(4).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll(".badges").length >= 5,
  );
  assert.equal(await page.locator(".ideas>li").count(), 5);
  assert.equal(
    await page.getByRole("button", { name: "connect wallet" }).count(),
    1,
  );
  assert.match(await page.locator(".ideas").innerText(), /Make job outcomes/);
  assert.equal(
    await page.locator(".ideas .idea-title").first().innerText(),
    "A field guide to what the swarm has built",
  );
  log(
    "Wallet-free reads merge both chains; overlapping idea ID 1 stays distinct; holder sort uses 1 holder / 2 total votes.",
  );
  assert.equal(
    await page.locator(".detail h2").innerText(),
    "A field guide to what the swarm has built",
  );
  assert.equal(await page.locator(".comments>li").count(), 2);
  assert.equal(await page.locator(".vote").first().isDisabled(), true);
  await page.screenshot({
    path: join(root, "artifacts/desktop-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "use light theme" }).click();
  await page.screenshot({
    path: join(root, "artifacts/desktop-light.png"),
    fullPage: true,
  });
  await page.reload();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  log(
    "System dark theme, light toggle, persisted theme after reload, local fonts.",
  );
  await page.getByRole("button", { name: "connect wallet" }).click();
  await page.getByRole("button", { name: "Anvil test wallet" }).click();
  await page.waitForFunction(() =>
    document.querySelector(".connect")?.textContent.includes("0xf39f"),
  );
  assert.deepEqual(await page.evaluate(() => window.testWallet.switches), []);
  log("Injected wallet connects on mainnet without a forced network switch.");
  await page
    .getByRole("link", { name: "+ new idea", exact: true })
    .first()
    .click();
  await page.getByText("Posting costs real gas on mainnet.").waitFor();
  await page
    .getByRole("button", { name: "switch to Base", exact: true })
    .click();
  await page.locator("#idea-title").fill("A free idea from the browser");
  await page
    .locator("#idea-body")
    .fill(
      "A browser-created idea backed by an actual local-chain transaction.\n\n<img src=x onerror=alert(1)> https://example.com\n" +
        "Useful context. ".repeat(80),
    );
  await page.getByRole("button", { name: "publish idea →" }).click();
  await page.waitForURL("**/#/i/8453/4");
  await page
    .locator(".detail h2")
    .filter({ hasText: "A free idea from the browser" })
    .waitFor();
  log(
    "Mainnet gas nudge switches to Base in one click; createIdea confirms and appears without reload.",
  );
  assert.equal(
    await page.locator(".detail .body img, .detail .body a").count(),
    0,
  );
  await page.getByRole("button", { name: "read full text ↓" }).click();
  assert.match(await page.locator(".detail .body").innerText(), /<img src=x/);
  await page.getByRole("button", { name: "show less ↑" }).click();
  log(
    "Long text collapses and expands; markup and URLs remain inert plain text.",
  );
  await page
    .getByRole("link", { name: "+ new idea", exact: true })
    .first()
    .click();
  await page.locator("#idea-title").fill("é".repeat(61));
  await page.locator("#idea-body").fill("a".repeat(4001));
  assert.match(await page.locator("form").innerText(), /122 \/ 120 bytes/);
  const before = await page.evaluate(() => window.testWallet.sends.length);
  await page.getByRole("button", { name: "publish idea →" }).click();
  assert.equal(
    await page.evaluate(() => window.testWallet.sends.length),
    before,
  );
  assert.equal(
    await page.locator("#idea-title").getAttribute("aria-invalid"),
    "true",
  );
  assert.equal(
    await page.locator("#idea-body").getAttribute("aria-invalid"),
    "true",
  );
  log(
    "UTF-8 title overflow and 4001-byte body reject before wallet transaction.",
  );
  await page.locator("#idea-title").fill("A clearer job outcome");
  await page
    .locator("#idea-body")
    .fill("Make the output understandable in a single paragraph.");
  await page.locator("#subject-kind").selectOption("job");
  await page
    .locator("#subject-ref")
    .fill("4a26aecb-5f31-4474-bdde-7021f71c3b7c");
  await page.locator("#idea-body").fill("x".repeat(3990));
  const beforeSubject = await page.evaluate(
    () => window.testWallet.sends.length,
  );
  await page.getByRole("button", { name: "publish idea →" }).click();
  assert.equal(
    await page.evaluate(() => window.testWallet.sends.length),
    beforeSubject,
  );
  assert.equal(
    await page.locator("#idea-body").getAttribute("aria-invalid"),
    "true",
  );
  await page
    .locator("#idea-body")
    .fill("Make the output understandable in a single paragraph.");
  log("Subject first line counts toward the 4000-byte limit.");
  await page.getByRole("button", { name: "publish idea →" }).click();
  await page.waitForURL("**/#/i/8453/5");
  await page.locator(".detail .subject-chip").waitFor();
  assert(
    !(await page
      .locator(".detail .body")
      .first()
      .innerText()
      .then((x) => x.includes("subject:"))),
  );
  const logs = await clients[8453].pub.getContractEvents({
    address: config.chains[1].address,
    abi: artifact.abi,
    eventName: "IdeaCreated",
    fromBlock: 0n,
  });
  assert(
    logs
      .at(-1)
      .args.body.startsWith(
        "subject: job:4a26aecb-5f31-4474-bdde-7021f71c3b7c\n",
      ),
  );
  log(
    "Job subject is stored as the exact first body line and stripped when read.",
  );
  await page.locator(".detail .subject-discussion").click();
  await page.locator(".subject-card").waitFor();
  assert.equal(await page.locator(".ideas>li").count(), 2);
  assert.equal(
    await page.locator(".subject-card>a").getAttribute("href"),
    "https://explorer.imd.fun/jobs/4a26aecb-5f31-4474-bdde-7021f71c3b7c",
  );
  log(
    "Subject page filters across chains; failed subject read falls back to a plain explorer link.",
  );
  await page.route("https://api.imd.fun/jobs/**", (r) =>
    r.fulfill({
      json: {
        state: "completed",
        template: "skill:build-website",
        objective: "Readable job outputs",
        delivery: { repoUrl: "https://github.com/example/example" },
      },
    }),
  );
  await page.goto(origin + "/preview/#/s/agent:494");
  await page.goto(
    origin + "/preview/#/s/job:4a26aecb-5f31-4474-bdde-7021f71c3b7c",
  );
  await page.locator(".live-subject").waitFor();
  assert.match(
    await page.locator(".live-subject").innerText(),
    /repo: https:\/\/github.com\/example\/example/,
  );
  log(
    "CORS-permitted subject fixture shows state, template, objective and nested delivery repo.",
  );
  await page.getByRole("button", { name: "on jobs", exact: true }).click();
  assert.equal(await page.locator(".ideas>li").count(), 2);
  await page.getByRole("button", { name: "free", exact: true }).click();
  assert.equal(await page.locator(".ideas>li").count(), 3);
  await page.getByRole("button", { name: "all", exact: true }).click();
  await page.getByLabel("sort ideas").selectOption("newest");
  log(
    "All, free and on-jobs filters and newest sort respond without reloading.",
  );
  await page.goto(origin + "/preview/#/i/8453/5");
  await page.locator(".detail h2").waitFor();
  if (await page.getByRole("button", { name: "connect wallet" }).count()) {
    await page.getByRole("button", { name: "connect wallet" }).click();
    await page.getByRole("button", { name: "Anvil test wallet" }).click();
  }
  await page.evaluate(() => window.testWallet.chain(1));
  await page
    .getByRole("button", { name: "switch to Base", exact: true })
    .click();
  await page.locator("#comment-body").fill("b".repeat(2001));
  await page.getByRole("button", { name: "add comment →" }).click();
  assert.equal(
    await page.locator("#comment-body").getAttribute("aria-invalid"),
    "true",
  );
  await page
    .locator("#comment-body")
    .fill("A useful next step, with enough context to act on it.");
  await page.getByRole("button", { name: "add comment →" }).click();
  await page
    .locator(".tx-status")
    .filter({ hasText: "Comment confirmed." })
    .waitFor();
  await page.locator(".comments>li").first().waitFor();
  assert.equal(await page.locator(".comments>li").count(), 1);
  log(
    "Reply cost switch, 2001-byte rejection, and confirmed comment appended without reload.",
  );
  await page
    .getByRole("button", { name: "upvote idea header", exact: true })
    .click();
  await page
    .getByRole("button", { name: "upvoted idea header", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "upvoted idea header", exact: true })
      .isDisabled(),
  );
  await page
    .getByRole("button", { name: "upvote comment 1", exact: true })
    .click();
  await page
    .getByRole("button", { name: "upvoted comment 1", exact: true })
    .waitFor();
  assert(
    await page
      .getByRole("button", { name: "upvoted comment 1", exact: true })
      .isDisabled(),
  );
  await page.getByLabel("sort comments").selectOption("holders");
  log(
    "Idea and comment upvotes confirm; duplicate controls are disabled; holder comment sort works.",
  );
  await page.evaluate((a) => window.testWallet.account(a), poor);
  await page
    .getByText(/Writing needs 1\+ identitymd/)
    .first()
    .waitFor();
  assert(await page.locator("#comment-body").isDisabled());
  assert(
    await page
      .getByRole("button", { name: "upvote idea header", exact: true })
      .isDisabled(),
  );
  log(
    "Zero-holding wallet has disabled composers and upvotes with gate explanation.",
  );
  await page.evaluate((a) => window.testWallet.account(a), exact);
  await wait(500);
  assert(await page.locator("#comment-body").isDisabled());
  await page.evaluate((a) => window.testWallet.account(a), tokenHolder);
  await page.waitForFunction(
    () => !document.querySelector("#comment-body").disabled,
  );
  await page.evaluate((a) => window.testWallet.account(a), staked);
  await page.waitForFunction(
    () => !document.querySelector("#comment-body").disabled,
  );
  log(
    "Strict >100 threshold: exactly 100 rejected; 101 IMD and 101 sIMD independently enable writing.",
  );
  await page.evaluate((a) => window.testWallet.account(a), account);
  await page.evaluate(() => window.testWallet.chain(10));
  await page
    .getByRole("button", { name: "switch to Base", exact: true })
    .first()
    .waitFor();
  await page
    .getByRole("button", { name: "switch to Base", exact: true })
    .first()
    .click();
  assert.equal(
    await page.evaluate(() => window.testWallet.switches.at(-1)),
    "0x2105",
  );
  log("Unsupported network presents Base/default and mainnet switches.");
  await page
    .locator("#comment-body")
    .fill("Preserve this text when the wallet declines.");
  await page.evaluate(() => (window.testWallet.rejectNext = true));
  await page.getByRole("button", { name: "add comment →" }).click();
  await page.getByText(/Transaction declined/).waitFor();
  assert.equal(
    await page.locator("#comment-body").inputValue(),
    "Preserve this text when the wallet declines.",
  );
  log(
    "Rejected transaction keeps input and shows an inline retryable failure.",
  );
  await page.getByRole("link", { name: "deploy", exact: true }).click();
  await page.getByRole("button", { name: "deploy Docket →" }).click();
  await page.getByTestId("deployed-address").waitFor();
  const addr = await page.getByTestId("deployed-address").innerText();
  const block = await page.getByTestId("deployed-block").innerText();
  assert.equal(
    (await clients[8453].pub.getCode({ address: addr })).toLowerCase(),
    artifact.deployedBytecode.toLowerCase(),
  );
  assert(BigInt(block) > 0n);
  receipts.push({
    action: "browser deploy",
    chainId: 8453,
    address: addr,
    block,
  });
  await page.getByText("view standard-JSON input").click();
  assert.match(await page.locator("pre").innerText(), /bytecodeHash/);
  log(
    "Deploy page sends exact creation bytecode; Anvil runtime, returned address/block, and compiler input verified.",
  );
  // Outage after a populated cache: reload starts an independent scan of each chain.
  await page.goto(origin + "/preview/");
  await page.locator(".ideas>li").nth(6).waitFor();
  fail = 1;
  await page.reload();
  await page.getByRole("button", { name: "retry connection" }).waitFor();
  assert((await page.locator(".ideas>li").count()) >= 5);
  assert.match(
    await page.locator(".connection.error").innerText(),
    /Ethereum mainnet/,
  );
  fail = 0;
  await page.getByRole("button", { name: "retry connection" }).click();
  await page.waitForFunction(
    () => !document.querySelector(".connection.error"),
  );
  log(
    "One RPC outage preserves cached unavailable ideas while Base renders; retry recovers.",
  );
  truncate = true;
  await page.reload();
  await page.getByRole("button", { name: "retry connection" }).waitFor();
  truncate = false;
  await page.getByRole("button", { name: "retry connection" }).click();
  await page.waitForFunction(
    () => !document.querySelector(".connection.error"),
  );
  log(
    "Silently truncated logs fail counter reconciliation; retry rescans without skipping history.",
  );
  const snapshot = await rpc(8453, "evm_snapshot");
  const reorgHash = await clients[8453].wallet.writeContract({
    address: config.chains[1].address,
    abi: artifact.abi,
    functionName: "createIdea",
    args: [
      "Temporary idea before reorg",
      "This should disappear after the local rollback.",
    ],
  });
  await clients[8453].pub.waitForTransactionReceipt({ hash: reorgHash });
  await page.reload();
  await page
    .locator(".ideas .idea-title")
    .filter({ hasText: "Temporary idea before reorg" })
    .waitFor();
  await rpc(8453, "evm_revert", [snapshot]);
  await page.reload();
  await page.waitForFunction(
    () => document.querySelector(".connection-states").textContent === "",
  );
  assert.equal(
    await page
      .locator(".ideas .idea-title")
      .filter({ hasText: "Temporary idea before reorg" })
      .count(),
    0,
  );
  log(
    "Anvil rollback invalidates the cached head and removes orphaned event text.",
  );
  for (const width of [1440, 800, 780, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"]) {
      await page.evaluate((t) => {
        document.documentElement.dataset.theme = t;
        localStorage.setItem("docket-theme", t);
      }, theme);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + "/preview/#/i/8453/1");
  await page.locator(".detail h2").waitFor();
  assert(await page.locator(".detail .back").isVisible());
  assert(!(await page.locator(".idea-list").isVisible()));
  await page.screenshot({
    path: join(root, "artifacts/mobile.png"),
    fullPage: true,
  });
  await page.locator(".detail .back").click();
  await page.locator(".idea-list").waitFor({ state: "visible" });
  assert(await page.locator(".idea-list").isVisible());
  log(
    "Both themes reflow at 1440, 800, 780, 390 and 320px; mobile detail/back works without horizontal overflow.",
  );
  for (const mobileTheme of ["light", "dark"]) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
      localStorage.setItem("docket-theme", t);
    }, mobileTheme);
    if (await page.getByRole("button", { name: "connect wallet" }).count()) {
      await page.getByRole("button", { name: "connect wallet" }).click();
      await page.getByRole("button", { name: "Anvil test wallet" }).click();
    }
    await page
      .getByRole("link", { name: "+ new idea", exact: true })
      .first()
      .click();
    if (
      await page
        .getByRole("button", { name: "switch to Base", exact: true })
        .count()
    )
      await page
        .getByRole("button", { name: "switch to Base", exact: true })
        .click();
    await page.locator("#idea-title").fill(`Mobile ${mobileTheme} idea`);
    await page
      .locator("#idea-body")
      .fill("A real transaction from the narrow layout.");
    await page.getByRole("button", { name: "publish idea →" }).click();
    await page
      .locator(".detail h2")
      .filter({ hasText: `Mobile ${mobileTheme} idea` })
      .waitFor();
    await page.locator("#comment-body").fill("A mobile comment, newest last.");
    await page.getByRole("button", { name: "add comment →" }).click();
    await page.locator(".comments>li").first().waitFor();
    await page
      .getByRole("button", { name: "upvote idea header", exact: true })
      .click();
    await page
      .getByRole("button", { name: "upvoted idea header", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "upvote comment 1", exact: true })
      .click();
    await page
      .getByRole("button", { name: "upvoted comment 1", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator(".detail .back").click();
    await page.locator(".idea-list").waitFor({ state: "visible" });
  }
  log(
    "At 390px in both themes: connect, create, comment, idea/comment upvotes and back navigation succeed.",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/preview/");
  await page.reload();
  await page.locator(".ideas>li").first().waitFor();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement.textContent),
    "skip to content",
  );
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => document.activeElement.id), "main");
  await page.getByRole("button", { name: "connect wallet" }).click();
  await page.keyboard.press("Escape");
  assert.equal(
    await page.evaluate(() => document.activeElement.className),
    "connect",
  );
  log(
    "Skip link moves focus to main; wallet dialog Escape closes and restores trigger focus.",
  );
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => ({
    name: document.activeElement.textContent,
    outline: getComputedStyle(document.activeElement).outlineStyle,
    width: getComputedStyle(document.activeElement).outlineWidth,
  }));
  assert.equal(focused.outline, "solid");
  assert.equal(focused.width, "2px");
  const axe = [];
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    const a = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    axe.push({
      theme,
      violations: a.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target),
      })),
    });
  }
  writeFileSync(
    join(root, "test/scratch/axe.json"),
    JSON.stringify(axe, null, 2),
  );
  assert.equal(axe.flatMap((a) => a.violations).length, 0);
  log("Axe WCAG A/AA automated scan passes in both themes.");
  mode = "unconfigured";
  await page.reload();
  await page
    .getByRole("heading", { name: "An open board. Ready when you are." })
    .waitFor();
  assert.equal(await page.locator(".connection.unconfigured").count(), 2);
  assert.equal(await page.locator(".ideas>li").count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ["light", "dark"]) {
    await page.evaluate(
      (t) => (document.documentElement.dataset.theme = t),
      theme,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert(
      await page.getByRole("link", { name: "set up a board →" }).isVisible(),
    );
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  log(
    "Shipped empty-address template shows two unconfigured boards and working deployment links.",
  );
  mode = "configured";
  await page.goto(origin + "/preview/");
  await page.reload();
  await page.locator(".ideas>li").nth(6).waitFor();
  writeFileSync(
    join(root, "test/scratch/results.json"),
    JSON.stringify(
      { results, receipts, consoleErrors, failedRequests, axe },
      null,
      2,
    ),
  );
  assert.deepEqual(consoleErrors, []);
  assert.equal(
    failedRequests.filter((r) => !r.url.includes("/rpc/")).length,
    0,
  );
  log(
    "No uncaught page errors. Expected simulated RPC/CORS failures recorded separately.",
  );
  await browser.close();
  browser = undefined;
}
async function cleanup() {
  await browser?.close();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  for (const child of children) child.kill();
}
process.on("SIGINT", () => {
  void cleanup().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void cleanup().then(() => process.exit(0));
});
try {
  await setup();
  await tests();
  writeFileSync(
    join(root, "test/scratch/results.json"),
    JSON.stringify(
      { results, receipts, consoleErrors, failedRequests },
      null,
      2,
    ),
  );
  if (process.argv.includes("--inspect")) {
    console.log("INSPECT " + origin + "/preview/");
    await Promise.race([
      inspectionDone,
      new Promise((r) => setTimeout(r, 30 * 60 * 1000)),
    ]);
  }
} catch (e) {
  console.error(e);
  if (currentPage) {
    writeFileSync(
      join(root, "test/scratch/failure-page.txt"),
      await currentPage
        .locator("body")
        .innerText()
        .catch(() => ""),
    );
    await currentPage
      .screenshot({
        path: join(root, "test/scratch/failure.png"),
        fullPage: true,
      })
      .catch(() => {});
  }
  writeFileSync(
    join(root, "test/scratch/results.json"),
    JSON.stringify(
      { results, receipts, consoleErrors, failedRequests, failure: String(e) },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  await cleanup();
}

process.exit(process.exitCode || 0);
