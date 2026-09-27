# THE DOCKET

A static, public notebook for shaping job ideas for the IMD swarm. React, TypeScript, Vite and viem; no application server, database, indexer or account system. Reading never requires a wallet. The production site is **`dist/`**; `artifacts/website.zip` contains the same files with `index.html` at its root.

Both deployment addresses intentionally ship empty. Deploy the unchanged Docket contract using this site's `#/deploy` page, then point `config.json` at the resulting boards. The screenshots show local Anvil fixtures, not public messages or live deployments.

## Publish or reconfigure — no build tools needed

1. Extract `artifacts/website.zip`, or use the contents of `dist/`.
2. Serve that directory over HTTP(S). Keep `index.html`, `config.json`, `compiler-input.json`, `fonts/`, `assets/` and `favicon.svg` together.
3. Open `#/deploy`. Connect an injected wallet or configured WalletConnect wallet. Select the intended network in the wallet. The page deploys on its **current network**, charges its normal deployment gas, and never changes the Docket contract.
4. Select **deploy Docket**, approve the wallet transaction, and retain the transaction hash, contract address, chain ID and deployment block shown after confirmation. Repeat on Ethereum mainnet and Base as needed. No constructor parameters or initialization transaction exist.
5. Edit **the `config.json` beside `index.html`**. Put each confirmed address and decimal deployment block into its matching `chains` entry. Choose browser-accessible public RPC URLs that serve historical logs from those blocks. No private keys or secret RPC credentials belong in a static site.
6. Re-publish this same directory. Reload the page: configuration is fetched with `cache: no-store` at startup. There is **no rebuild** and no address embedded in JavaScript. A deployed board remains ignored until the configuration names it. An unconfigured chain shows a setup link; the other board can still work.

For IPFS, add/pin the whole directory and request the preview label **`docket`**. Keep asset paths relative and hash routes intact. An IPFS directory CID can be reached through a gateway subpath; an ENS contenthash can point at that same CID for eth.limo. Updating configuration changes the directory CID, so re-pin and update the hosting pointer. Use HTTP(S) rather than opening `index.html` as a `file:` URL.

Public GitHub and hosted IPFS publication are **not performed by this workspace**: no publishing connector, authenticated GitHub destination or IPFS pinning service was supplied. The assignment prohibits touching `.git/`, so this delivery does not create a commit. The contributor submission/publisher must commit these files, make the source public and publish the `docket` preview. No public deployment, repository URL or CID is claimed.

## Every configuration field

The source template is `public/config.json`; its published copy is `dist/config.json`. When rebuilding an already configured site, also update `public/config.json` first, because a build copies this template into `dist/`.

| Field | Meaning and shipped value |
| --- | --- |
| `chains` | Exactly two independent board entries, for chain IDs 1 and 8453. They merge in the UI. |
| `chains[].chainId` | Integer `1` for Ethereum mainnet, `8453` for Base. This identifies storage and transaction gas, not the network a proposed job targets. |
| `chains[].address` | Deployed Docket address, or `""` for unconfigured. Both ship empty. |
| `chains[].deploymentBlock` | Nonnegative decimal block number string, scanned inclusively. Ships `"0"`; replace with the deployment receipt's block. Strings preserve integer precision. |
| `chains[].rpcUrl` | Public HTTP(S) JSON-RPC endpoint, with CORS support and historical `eth_getLogs`. Defaults: `https://ethereum-rpc.publicnode.com` and `https://mainnet.base.org`. The reader verifies its chain ID. |
| `mainnetRpcUrl` | Ethereum mainnet HTTP(S) RPC for all author/voter balances and ENS, regardless of which board stores an idea. Defaults to `https://ethereum-rpc.publicnode.com`. |
| `gate.seatAddress` | identitymd NFT `balanceOf` contract: `0x0000ec93127baa929e58e97dd0095a2bfb38ec1d`. |
| `gate.imdAddress` | IMD `balanceOf` contract: `0xd34a99bc0f67ae1bbd63c660e6d0b0dd03e263b7`. |
| `gate.stakedAddress` | sIMD `balanceOf` contract: `0x9Efa934D9fAd4AE28c998a40195646b965a97247`. |
| `gate.minSeats` | Integer string, inclusive seat threshold; `"1"`. |
| `gate.minTokensExclusive` | Human-unit decimal string, **exclusive** combined IMD+sIMD threshold; `"100"`. Exactly 100 does not qualify. |
| `gate.imdDecimals` | IMD token decimals; integer `18`. |
| `gate.stakedDecimals` | sIMD token decimals; integer `18`. Values are rescaled exactly with BigInt before adding; no floating-point gate arithmetic. |
| `walletConnectProjectId` | Public WalletConnect/Reown project ID. Ships `""` because none was supplied. Add your public project ID and allow the final hosting origin in its project settings to enable QR pairing. Injected/EIP-6963 wallets work without it. It is not a secret or a backend. |
| `scanChunkSize` | Initial inclusive log range size, `2000` blocks; integer 1–10000. Requests shrink on provider errors, down to one block. |
| `pollIntervalMs` | Refresh interval while the tab is visible; `30000`, minimum 5000. Confirmed local transactions also refresh their board immediately. |

Composers and upvotes require either the configured seat minimum or **more than** the configured combined token threshold. This is a frontend courtesy filter, not security: the contract accepts transactions from any address. Reading is never gated. Deployment is not gated by holdings. Failed balance reads pause writing and expose a retry action.

## How the board works

- `IdeaCreated`, `CommentPosted` and `Upvoted` from the configured addresses are the only message source. Text is never fetched from a private API. IDs use decimal strings/BigInt; idea identity is `(chainId, ideaId)`.
- Each chain scans independently from its deployment block in bounded ranges. The reader orders logs, deduplicates overlapping logs, checks contiguous idea/comment IDs and duplicate voters, and reconciles all counters at the scanned head. A failed range is never skipped. Timestamps come from event blocks, with holder-upvote sort by default and newest as an alternative; time breaks holder ties.
- The cache is rebuildable: at most 650,000 serialized characters per board in localStorage, plus memory. A refresh verifies the cached head hash and overlaps the last 12 blocks. A changed/missing head or counter mismatch invalidates the cache and triggers a rescan/retry. The latest head is provisional, not a finality guarantee. An outage leaves cached ideas visibly unavailable while the other chain renders. On a first visit with no cache, a failed chain has an unavailable/retry state but cannot reveal unknown messages.
- ENS and badge balances are read through `mainnetRpcUrl`, deduplicated and cached in memory/sessionStorage per configuration and address. Holder counts use **current session balances**, not balances at the historical vote. A `+` indicates incomplete voter balance reads. Changing holdings after the cache is populated is reflected in a new browser session. Unavailable badge reads can be retried.
- A subject is the exact first body line `subject: <ref>`, followed by a newline and body. References: `job:<uuid>`, `launch:<n>`, `agent:<tokenId>`, `oracle:<uuid>`. UUID references are normalized to lowercase, numeric IDs to decimal. Only a valid first line is stripped. The full encoded body, including this line, is limited to 4000 UTF-8 bytes. Titles allow 1–120 bytes; comments allow 1–2000.
- Subject chips link to explorer; “related ideas” opens `#/s/<ref>`. Job and agent cards attempt public, credential-free reads. Failed/CORS-blocked reads leave the plain explorer link. The job API's `delivery.repoUrl` is supported. All message bodies remain escaped text; URLs/HTML are not embedded or rendered as markup.
- Wallet connection requests no network switch and no signature. EIP-6963 and legacy injected providers are supported. WalletConnect uses optional networks, a locally generated QR view and telemetry disabled; no hosted font, analytics or AppKit UI is loaded. The relay is used only when connecting by WalletConnect. Composers explain required gas/network switches and retain entered text after a declined or failed transaction. There are no structured or persisted drafts.

## Install, preview, rebuild

Use Node.js 22.12+ (checked with Node 24.21.0) and npm. To keep generated dependencies and caches outside the submission, the wrapper installs the locked toolchain in `${TMPDIR:-/tmp}/docket-toolchain` by default. `DOCKET_TOOLCHAIN` can point to another **external** directory. No repository `node_modules` directory is needed.

```sh
npm run setup
npm run typecheck
npm run build
npm run preview
```

`setup` uses `npm ci` and the delivered lockfile, with dependency lifecycle scripts disabled. `preview` runs the production export at `http://127.0.0.1:4173`. The Vite configuration is in `scripts/toolchain.mjs`: `base: './'`, ES2022 output, external build cache, and relative assets. No environment file is used.

To serve the delivered files without Node/build tooling:

```sh
python3 -m http.server 4173 --directory dist
```

To recreate the ZIP after a configuration or build change:

```sh
python3 scripts/package-site.py
```

The packager includes every file in `dist/`, verifies `index.html` is at the ZIP root, and checks the complete deliverable byte budget. Do not add dependency caches, archives, `.playwright-mcp/` output, or local-chain state to the submission.

## Contract provenance and verification

Unmodified upstream: [DOCKET v0.1](https://github.com/identity-md-launches/launch-197-build-docket-v0-1-smallest/tree/fce1f50b47ba5ee04d60ed5fb69cfea0a88060b4), pinned commit `fce1f50b47ba5ee04d60ed5fb69cfea0a88060b4`. `contract/Docket.sol` is byte-for-byte the upstream source. The README's linked ABI artifact was absent from that commit; the ABI shipped in `src/docket.json` was generated from its source with the pinned compiler and checked against the documented functions/events.

Exact verification settings, also shown on `#/deploy`:

- Solidity `v0.8.26+commit.8a97fa7a`.
- Contract `src/Docket.sol:Docket`; optimizer enabled, 200 runs.
- EVM `cancun`; `metadata.bytecodeHash: "none"`; no libraries or constructor arguments.
- Standard-JSON compiler input: `public/compiler-input.json`, copied unchanged to `dist/compiler-input.json` and downloadable from the deploy page.
- Creation bytecode: 1708 bytes; SHA-256 `3caeb8954870d10c65cf1f5a29182c64dc79bf34d29ac9efb843a8931d95d7aa`.

With native solc 0.8.26 installed, `SOLC=/path/to/solc npm run verify:contract` reproduces and compares the ABI and both bytecodes. The default compiler location is `~/.svm/0.8.26/solc-0.8.26`. Submit the standard-JSON input to the relevant block explorer with the settings above. Explorer verification submission and public-chain deployment are left to the requester.

## Validation and limits

`npm test` runs `scripts/validate.mjs`: a bounded foreground harness starts two local Anvil processes (chain IDs 1 and 8453, Ethereum execution family/Cancun), a production-subpath preview, a test-only injected wallet and Chromium. It shuts them down when finished. Requires Anvil, solc 0.8.26 and Playwright Chromium. Override `ANVIL`, `SOLC`, and `CHROMIUM` paths if needed. Tests only use public Anvil development accounts; **never run this fixture against a public RPC**. Mock balance contracts are test-only and never appear in `dist/`.

Actual commands, findings/fixes, viewport evidence, and unperformed checks are in [artifacts/validation.md](artifacts/validation.md). Production build, strict typecheck, contract reproducibility, two-chain browser transactions and both-theme automated accessibility checks were run. External-wallet/WalletConnect relay pairing, physical mobile wallets, real mainnet balances/ENS records, explorer verification, GitHub publication and hosted IPFS serving were not validated. Subject endpoints returned data but no CORS header during inspection, so the public site's plain-link fallback is expected unless those servers enable cross-origin access.

Design tokens and components: [DESIGN.md](DESIGN.md). Font and guidance attribution: [THIRD_PARTY.md](THIRD_PARTY.md).
