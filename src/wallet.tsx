import { useEffect, useRef, useState } from "react";
import {
  createWalletClient,
  custom,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { chainFor, type Config } from "./config";
import { readableError } from "./model";
type Provider = EIP1193Provider & {
  on?: (event: string, listener: (value: unknown) => void) => void;
  removeListener?: (event: string, listener: (value: unknown) => void) => void;
  disconnect?: () => Promise<void>;
};
export interface WalletChoice {
  id: string;
  name: string;
  provider: Provider;
}
declare global {
  interface Window {
    ethereum?: Provider;
  }
}
export function useWallet(c: Config) {
  const [provider, setProvider] = useState<Provider>();
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [choices, setChoices] = useState<WalletChoice[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const cancelRef = useRef<() => void>(() => {});
  useEffect(() => {
    const announce = (event: Event) => {
      const d = (
        event as CustomEvent<{
          info: { uuid: string; name: string };
          provider: Provider;
        }>
      ).detail;
      setChoices((old) =>
        old.some((p) => p.id === d.info.uuid)
          ? old
          : [
              ...old,
              { id: d.info.uuid, name: d.info.name, provider: d.provider },
            ],
      );
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (window.ethereum)
      setChoices((old) =>
        old.length
          ? old
          : [
              {
                id: "injected",
                name: "browser wallet",
                provider: window.ethereum!,
              },
            ],
      );
    return () =>
      window.removeEventListener("eip6963:announceProvider", announce);
  }, []);
  useEffect(() => {
    if (!provider) return;
    const account = (value: unknown) => {
      setAddress((value as Address[])[0]);
    };
    const chain = (value: unknown) => setChainId(Number(value));
    const disconnect = () => {
      setAddress(undefined);
      setProvider(undefined);
      setChainId(undefined);
    };
    provider.on?.("accountsChanged", account);
    provider.on?.("chainChanged", chain);
    provider.on?.("disconnect", disconnect);
    return () => {
      provider.removeListener?.("accountsChanged", account);
      provider.removeListener?.("chainChanged", chain);
      provider.removeListener?.("disconnect", disconnect);
    };
  }, [provider]);
  async function connect(choice?: WalletChoice) {
    setBusy(true);
    setError("");
    try {
      let p: Provider;
      if (choice) p = choice.provider;
      else {
        const { EthereumProvider } = await import(
          "@walletconnect/ethereum-provider"
        );
        const wc = await EthereumProvider.init({
          projectId: c.walletConnectProjectId,
          optionalChains: [8453, 1],
          showQrModal: false,
          telemetryEnabled: false,
          methods: ["eth_sendTransaction"],
          optionalMethods: [
            "eth_sendTransaction",
            "wallet_switchEthereumChain",
            "wallet_addEthereumChain",
          ],
          rpcMap: Object.fromEntries(
            c.chains.map((b) => [b.chainId, b.rpcUrl]),
          ),
          metadata: {
            name: "THE DOCKET",
            description: "Job ideas for the IMD swarm",
            url: location.origin,
            icons: [new URL("./favicon.svg", location.href).href],
          },
        });
        wc.on("display_uri", async (uri: string) => {
          const { toDataURL } = await import("qrcode");
          setQr(await toDataURL(uri, { width: 280, margin: 2 }));
        });
        await Promise.race([
          wc.connect(),
          new Promise<never>((_, reject) => {
            cancelRef.current = () => {
              wc.signer.abortPairingAttempt();
              setQr("");
              reject(new Error("Wallet connection cancelled."));
            };
          }),
        ]);
        setQr("");
        p = wc as unknown as Provider;
      }
      const accounts = await p.request({ method: "eth_requestAccounts" });
      const id = await p.request({ method: "eth_chainId" });
      setProvider(p);
      setAddress(accounts[0]);
      setChainId(Number(id));
      return true;
    } catch (e) {
      setError(readableError(e));
      return false;
    } finally {
      setBusy(false);
      cancelRef.current = () => {};
    }
  }
  async function switchTo(id: number) {
    if (!provider) return;
    setError("");
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${id.toString(16)}` }],
      });
      setChainId(Number(await provider.request({ method: "eth_chainId" })));
    } catch (e) {
      if ((e as { code?: number }).code === 4902) {
        try {
          const b = c.chains.find((x) => x.chainId === id)!;
          await provider.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: `0x${id.toString(16)}`,
                chainName: id === 1 ? "Ethereum" : "Base",
                nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
                rpcUrls: [b.rpcUrl],
              },
            ],
          });
          await provider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: `0x${id.toString(16)}` }],
          });
          setChainId(Number(await provider.request({ method: "eth_chainId" })));
        } catch (err) {
          setError(readableError(err));
        }
      } else setError(readableError(e));
    }
  }
  async function client(expected?: number) {
    if (!provider || !address) throw new Error("Connect a wallet first.");
    const current = Number(await provider.request({ method: "eth_chainId" }));
    if (expected !== undefined && current !== expected)
      throw new Error(
        "Wallet network changed. Review the fee notice and switch before sending.",
      );
    const accounts = await provider.request({ method: "eth_accounts" });
    if (accounts[0]?.toLowerCase() !== address.toLowerCase())
      throw new Error("Wallet account changed. Reconnect before sending.");
    const b = c.chains.find((x) => x.chainId === current);
    return createWalletClient({
      account: address,
      chain: b ? chainFor(b) : undefined,
      transport: custom(provider),
    });
  }
  async function deployReceipt(hash: Hex, expected: number) {
    if (!provider) throw new Error("Reconnect to read the receipt.");
    const { createPublicClient } = await import("viem");
    const receipt = await createPublicClient({
      transport: custom(provider),
      pollingInterval: 1000,
    }).waitForTransactionReceipt({ hash, timeout: 180000 });
    if (Number(await provider.request({ method: "eth_chainId" })) !== expected)
      throw new Error(
        "Wallet network changed during deployment. Return to the original network to check the transaction.",
      );
    return receipt;
  }
  return {
    provider,
    address,
    chainId,
    choices,
    error,
    busy,
    qr,
    cancelConnect: () => cancelRef.current(),
    connect,
    switchTo,
    client,
    deployReceipt,
    disconnect: async () => {
      await provider?.disconnect?.();
      setProvider(undefined);
      setAddress(undefined);
      setChainId(undefined);
    },
  };
}
export type Wallet = ReturnType<typeof useWallet>;
