// Test-only EIP-1193 wallet, backed by unlocked Anvil accounts. Never included in dist.
(() => {
  const listeners = new Map();
  let chain = 1;
  let account = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
  let connected = false;
  window.testWallet = {
    switches: [],
    sends: [],
    rejectNext: false,
    account(a) {
      account = a;
      listeners.get("accountsChanged")?.forEach((f) => f([a]));
    },
    chain(id) {
      chain = id;
      listeners.get("chainChanged")?.forEach((f) => f("0x" + id.toString(16)));
    },
  };
  const provider = {
    on(e, f) {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e).add(f);
    },
    removeListener(e, f) {
      listeners.get(e)?.delete(f);
    },
    async request({ method, params }) {
      if (method === "eth_requestAccounts") {
        connected = true;
        return [account];
      }
      if (method === "eth_accounts") return connected ? [account] : [];
      if (method === "eth_chainId") return "0x" + chain.toString(16);
      if (method === "wallet_switchEthereumChain") {
        window.testWallet.switches.push(params[0].chainId);
        window.testWallet.chain(Number(params[0].chainId));
        return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      if (method === "eth_sendTransaction") {
        if (window.testWallet.rejectNext) {
          window.testWallet.rejectNext = false;
          throw Object.assign(new Error("User rejected request"), {
            code: 4001,
          });
        }
        window.testWallet.sends.push({ chain, ...params[0] });
      }
      const r = await fetch("/rpc/" + chain, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method,
          params: params || [],
        }),
      });
      const j = await r.json();
      if (j.error)
        throw Object.assign(new Error(j.error.message), { code: j.error.code });
      return j.result;
    },
  };
  window.ethereum = provider;
  function announce() {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: {
          info: { uuid: "local-anvil", name: "Anvil test wallet" },
          provider,
        },
      }),
    );
  }
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
})();
