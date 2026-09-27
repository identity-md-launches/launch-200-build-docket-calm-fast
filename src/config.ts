import {
  createPublicClient,
  defineChain,
  http,
  isAddress,
  type Address,
  type Chain,
} from "viem";
import { mainnet, base } from "viem/chains";
export interface BoardConfig {
  chainId: number;
  address: string;
  deploymentBlock: string;
  rpcUrl: string;
}
export interface Config {
  chains: BoardConfig[];
  mainnetRpcUrl: string;
  gate: {
    seatAddress: Address;
    imdAddress: Address;
    stakedAddress: Address;
    minSeats: string;
    minTokensExclusive: string;
    imdDecimals: number;
    stakedDecimals: number;
  };
  walletConnectProjectId: string;
  scanChunkSize: number;
  pollIntervalMs: number;
}
const url = (value: unknown) =>
  typeof value === "string" && /^https?:\/\//.test(value);
export async function loadConfig(): Promise<Config> {
  const response = await fetch("./config.json", { cache: "no-store" });
  if (!response.ok)
    throw new Error(
      "config.json could not be read. Check the static files and retry.",
    );
  const c = (await response.json()) as Config;
  if (
    !Array.isArray(c.chains) ||
    c.chains.length !== 2 ||
    new Set(c.chains.map((x) => x.chainId)).size !== 2 ||
    !c.chains.some((x) => x.chainId === 1) ||
    !c.chains.some((x) => x.chainId === 8453)
  )
    throw new Error(
      "config.json needs entries for Ethereum (1) and Base (8453).",
    );
  for (const b of c.chains)
    if (
      !url(b.rpcUrl) ||
      (b.address !== "" && !isAddress(b.address, { strict: false })) ||
      !/^\d+$/.test(b.deploymentBlock)
    )
      throw new Error(
        "Check each address, deploymentBlock and rpcUrl in config.json.",
      );
  if (
    !url(c.mainnetRpcUrl) ||
    !c.gate ||
    !["seatAddress", "imdAddress", "stakedAddress"].every((k) =>
      isAddress(c.gate[k as "seatAddress"], { strict: false }),
    ) ||
    !/^\d+$/.test(c.gate.minSeats) ||
    !/^\d+(\.\d+)?$/.test(c.gate.minTokensExclusive) ||
    ![c.gate.imdDecimals, c.gate.stakedDecimals].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 36,
    ) ||
    c.gate.minTokensExclusive.split(".")[1]?.length >
      Math.max(c.gate.imdDecimals, c.gate.stakedDecimals)
  )
    throw new Error(
      "Check the mainnet RPC, gate token addresses, decimals and thresholds in config.json.",
    );
  if (
    !Number.isInteger(c.scanChunkSize) ||
    c.scanChunkSize < 1 ||
    c.scanChunkSize > 10000 ||
    !Number.isInteger(c.pollIntervalMs) ||
    c.pollIntervalMs < 5000 ||
    typeof c.walletConnectProjectId !== "string"
  )
    throw new Error(
      "Check scanChunkSize (1–10000), pollIntervalMs (at least 5000), and walletConnectProjectId in config.json.",
    );
  return c;
}
export const chainName = (id: number) =>
  id === 1 ? "Ethereum mainnet" : id === 8453 ? "Base" : `chain ${id}`;
export function chainFor(b: BoardConfig): Chain {
  return defineChain({
    ...(b.chainId === 1 ? mainnet : base),
    id: b.chainId,
    rpcUrls: { default: { http: [b.rpcUrl] } },
  });
}
export const clientFor = (b: BoardConfig) =>
  createPublicClient({
    chain: chainFor(b),
    transport: http(b.rpcUrl, { timeout: 12000, retryCount: 0 }),
    batch: { multicall: false },
    cacheTime: 0,
  });
export const badgeClient = (c: Config) =>
  createPublicClient({
    chain: mainnet,
    transport: http(c.mainnetRpcUrl, { timeout: 10000, retryCount: 0 }),
    batch: { multicall: false },
  });
