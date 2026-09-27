import { useCallback, useEffect, useRef, useState } from "react";
import { type Address, type Hex } from "viem";
import { clientFor, type BoardConfig, type Config } from "./config";
import { abi, replay, type EventRecord, type Idea } from "./model";
interface Cache {
  head: string;
  hash: Hex;
  records: EventRecord[];
}
export interface BoardState {
  chainId: number;
  status: "unconfigured" | "loading" | "ready" | "error";
  ideas: Idea[];
  message?: string;
  progress?: string;
}
const caches = new Map<string, Cache>();
const cacheKey = (b: BoardConfig) =>
  `docket-events-v1:${b.chainId}:${b.address.toLowerCase()}:${b.deploymentBlock}:${b.rpcUrl}`;
function load(b: BoardConfig): Cache | undefined {
  const key = cacheKey(b);
  if (caches.has(key)) return caches.get(key);
  try {
    const data = JSON.parse(localStorage.getItem(key) || "null");
    if (
      data &&
      Array.isArray(data.records) &&
      typeof data.head === "string" &&
      typeof data.hash === "string"
    ) {
      replay(data.records, b.chainId);
      caches.set(key, data);
      return data;
    }
  } catch {
    /* Cache is expendable. */
  }
}
function save(b: BoardConfig, data: Cache) {
  const key = cacheKey(b);
  caches.set(key, data);
  try {
    const json = JSON.stringify(data);
    if (json.length < 650000) localStorage.setItem(key, json);
    else localStorage.removeItem(key);
  } catch {
    /* Quota/private-mode: keep memory cache. */
  }
}
function clear(b: BoardConfig) {
  caches.delete(cacheKey(b));
  try {
    localStorage.removeItem(cacheKey(b));
  } catch {
    /* Private-mode storage. */
  }
}
async function pool<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
export async function scan(
  b: BoardConfig,
  size: number,
  progress: (value: string) => void,
): Promise<Idea[]> {
  const client = clientFor(b);
  if ((await client.getChainId()) !== b.chainId)
    throw new Error("RPC returned the wrong network. Check config.json.");
  const head = await client.getBlock();
  const h = head.number;
  const start = BigInt(b.deploymentBlock);
  if (start > h)
    throw new Error(
      "Deployment block is ahead of the RPC. Check config.json or retry.",
    );
  let cached = load(b);
  if (cached) {
    const old = BigInt(cached.head);
    if (
      old > h ||
      (await client.getBlock({ blockNumber: old })).hash !== cached.hash
    ) {
      clear(b);
      cached = undefined;
    }
  }
  let from = cached
    ? BigInt(cached.head) > start + 12n
      ? BigInt(cached.head) - 12n
      : start
    : start;
  let records: EventRecord[] = cached
    ? cached.records.filter((e) => BigInt(e.blockNumber) < from)
    : [];
  let chunk = BigInt(size);
  while (from <= h) {
    const to = from + chunk - 1n > h ? h : from + chunk - 1n;
    progress(`Reading blocks ${from}–${to}`);
    let logs;
    try {
      logs = await client.getLogs({
        address: b.address as Address,
        events: abi.filter((x) => x.type === "event"),
        fromBlock: from,
        toBlock: to,
        strict: true,
      });
    } catch (error) {
      if (chunk > 1n) {
        chunk = chunk / 2n || 1n;
        continue;
      }
      throw error;
    }
    const blockTimes = new Map<string, number>();
    await pool(
      [...new Set(logs.map((l) => l.blockNumber.toString()))],
      async (n) => {
        blockTimes.set(
          n,
          Number((await client.getBlock({ blockNumber: BigInt(n) })).timestamp),
        );
      },
    );
    records.push(
      ...logs.map((l) => ({
        blockNumber: l.blockNumber.toString(),
        blockHash: l.blockHash,
        transactionHash: l.transactionHash,
        logIndex: l.logIndex,
        transactionIndex: l.transactionIndex,
        topics: l.topics as Hex[],
        data: l.data,
        time: blockTimes.get(l.blockNumber.toString())!,
      })),
    );
    from = to + 1n;
  }
  try {
    const ideas = replay(records, b.chainId);
    const read = { address: b.address as Address, abi, blockNumber: h };
    if (
      (await client.readContract({ ...read, functionName: "ideaCount" })) !==
      BigInt(ideas.length)
    )
      throw new Error("Idea history is incomplete. Retry to rescan.");
    await pool(ideas, async (idea) => {
      if (
        (await client.readContract({
          ...read,
          functionName: "commentCount",
          args: [BigInt(idea.id)],
        })) !== BigInt(idea.comments.length)
      )
        throw new Error("Comment history is incomplete. Retry to rescan.");
      for (const target of [{ ...idea, id: "0" }, ...idea.comments])
        if (
          (await client.readContract({
            ...read,
            functionName: "upvotes",
            args: [BigInt(idea.id), BigInt(target.id)],
          })) !== BigInt(target.voters.length)
        )
          throw new Error("Vote history is incomplete. Retry to rescan.");
    });
    if ((await client.getBlock({ blockNumber: h })).hash !== head.hash)
      throw new Error("The chain changed during sync. Retry to rescan.");
    save(b, { head: h.toString(), hash: head.hash, records });
    return ideas;
  } catch (error) {
    clear(b);
    throw error;
  }
}
export function useBoards(config: Config) {
  const [states, setStates] = useState<BoardState[]>(() =>
    config.chains.map((b) => ({
      chainId: b.chainId,
      status: b.address ? "loading" : "unconfigured",
      ideas: b.address ? replay(load(b)?.records || [], b.chainId) : [],
    })),
  );
  const active = useRef(new Map<number, Promise<void>>());
  const mounted = useRef(true);
  const refresh = useCallback(
    async (chainId?: number) => {
      await Promise.all(
        config.chains
          .filter((b) => b.address && (!chainId || b.chainId === chainId))
          .map((b) => {
            const current = active.current.get(b.chainId);
            if (current) return current;
            const update = (patch: Partial<BoardState>) => {
              if (mounted.current)
                setStates((old) =>
                  old.map((s) =>
                    s.chainId === b.chainId ? { ...s, ...patch } : s,
                  ),
                );
            };
            update({ status: "loading", message: undefined });
            const task = scan(b, config.scanChunkSize, (p) =>
              update({ progress: p }),
            )
              .then((ideas) =>
                update({ ideas, status: "ready", progress: undefined }),
              )
              .catch(() =>
                update({
                  status: "error",
                  message:
                    "Ideas are unavailable. Cached text may be out of date.",
                  progress: undefined,
                }),
              )
              .finally(() => active.current.delete(b.chainId));
            active.current.set(b.chainId, task);
            return task;
          }),
      );
    },
    [config],
  );
  useEffect(() => {
    mounted.current = true;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, config.pollIntervalMs);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [config, refresh]);
  return { states, refresh, ideas: states.flatMap((b) => b.ideas) };
}
