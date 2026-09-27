import { useEffect, useState } from "react";
import { formatUnits, parseAbi, parseUnits, type Address } from "viem";
import { badgeClient, type Config } from "./config";
export interface Badge {
  seats: bigint;
  imd: bigint;
  staked: bigint;
  eligible: boolean;
  name?: string;
  error?: boolean;
}
const balanceAbi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
]);
const cached = new Map<string, Promise<Badge>>();
const sessionKey = (c: Config, a: Address) =>
  `docket-badges-v1:${JSON.stringify(c.gate)}:${c.mainnetRpcUrl}:${a.toLowerCase()}`;
export function readBadge(c: Config, a: Address): Promise<Badge> {
  const key = sessionKey(c, a);
  if (cached.has(key)) return cached.get(key)!;
  const task = (async () => {
    try {
      const old = sessionStorage.getItem(key);
      if (old) {
        const b = JSON.parse(old);
        return {
          ...b,
          seats: BigInt(b.seats),
          imd: BigInt(b.imd),
          staked: BigInt(b.staked),
        } as Badge;
      }
    } catch {
      /* Session storage is optional. */
    }
    const client = badgeClient(c);
    try {
      const [seats, imd, staked] = await Promise.all(
        [c.gate.seatAddress, c.gate.imdAddress, c.gate.stakedAddress].map(
          (address) =>
            client.readContract({
              address: address.toLowerCase() as Address,
              abi: balanceAbi,
              functionName: "balanceOf",
              args: [a],
            }),
        ),
      );
      const scale = Math.max(c.gate.imdDecimals, c.gate.stakedDecimals);
      const total =
        imd * 10n ** BigInt(scale - c.gate.imdDecimals) +
        staked * 10n ** BigInt(scale - c.gate.stakedDecimals);
      const b: Badge = {
        seats,
        imd,
        staked,
        eligible:
          seats >= BigInt(c.gate.minSeats) ||
          total > parseUnits(c.gate.minTokensExclusive, scale),
      };
      try {
        b.name = (await client.getEnsName({ address: a })) || undefined;
      } catch {
        /* ENS is an optional label. */
      }
      try {
        sessionStorage.setItem(
          key,
          JSON.stringify(b, (_, v) =>
            typeof v === "bigint" ? v.toString() : v,
          ),
        );
      } catch {
        /* Private mode. */
      }
      return b;
    } catch {
      return { seats: 0n, imd: 0n, staked: 0n, eligible: false, error: true };
    }
  })();
  cached.set(key, task);
  return task;
}
export function useBadges(c: Config, addresses: Address[]) {
  const [badges, setBadges] = useState<Record<string, Badge>>({});
  const [tick, setTick] = useState(0);
  const keys = [...new Set(addresses.map((a) => a.toLowerCase()))]
    .sort()
    .join(",");
  useEffect(() => {
    let alive = true;
    const list = keys.split(",").filter(Boolean) as Address[];
    let index = 0;
    void Promise.all(
      Array.from({ length: Math.min(4, list.length) }, async () => {
        while (index < list.length) {
          const address = list[index++];
          const b = await readBadge(c, address);
          if (alive) setBadges((old) => ({ ...old, [address]: b }));
        }
      }),
    );
    return () => {
      alive = false;
    };
  }, [c, keys, tick]);
  return {
    badges,
    retry: () => {
      for (const a of keys.split(",").filter(Boolean))
        cached.delete(sessionKey(c, a as Address));
      setTick((t) => t + 1);
    },
  };
}
export const balanceText = (value: bigint, decimals: number) => {
  const s = formatUnits(value, decimals);
  const [whole, fraction] = s.split(".");
  return whole + (fraction ? "." + fraction.slice(0, 2) : "");
};
