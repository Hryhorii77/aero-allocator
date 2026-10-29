import { describe, expect, it, vi } from "vitest";
import { createConfig, createConnector, createStorage, http } from "wagmi";
import { connect, disconnect, reconnect } from "wagmi/actions";
import { base } from "wagmi/chains";
import { lazyConnector } from "./lazy-connector";

const ME = "0x1111111111111111111111111111111111111111" as const;
const META = { id: "fakeWallet", name: "Fake Wallet", type: "fakeWallet" };

/** A stand-in for WalletConnect/Coinbase: counts when its code is "downloaded" and when its provider is built. */
function setup(storedRecent?: string) {
  const loaded = vi.fn();
  const built = vi.fn();
  const provider = { request: vi.fn() };
  const factory = createConnector(() => ({
    id: META.id,
    name: META.name,
    type: META.type,
    // Like the real connectors, these reach each other through `this` (a detached call would throw).
    async connect() {
      await this.getProvider();
      return { accounts: await this.getAccounts(), chainId: await this.getChainId() } as never;
    },
    async disconnect() {},
    async getAccounts() {
      return [ME];
    },
    async getChainId() {
      return base.id;
    },
    async getProvider() {
      built();
      return provider;
    },
    async isAuthorized() {
      return true;
    },
    async switchChain() {
      await this.getProvider();
      return base;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
  const mem = new Map<string, string>(storedRecent ? [["wagmi.recentConnectorId", JSON.stringify(storedRecent)]] : []);
  const storage = createStorage({ storage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v), removeItem: (k) => void mem.delete(k) } });
  const config = createConfig({
    chains: [base],
    connectors: [
      lazyConnector(META, async () => {
        loaded();
        return factory;
      }),
    ],
    transports: { [base.id]: http("http://localhost:1") },
    storage,
    ssr: true,
  });
  return { config, loaded, built, mem };
}

describe("lazyConnector", () => {
  it("looks like the real connector to the wallet list and loads nothing when the config is built", () => {
    const { config, loaded } = setup();
    const c = config.connectors.find((x) => x.id === META.id)!;
    expect([c.id, c.name, c.type]).toEqual([META.id, META.name, META.type]);
    expect(loaded).not.toHaveBeenCalled();
  });

  it("is skipped by reconnect on a page load when it was not the last wallet used: nothing is downloaded", async () => {
    const { config, loaded, built } = setup();
    await reconnect(config);
    await new Promise((r) => setTimeout(r, 20));
    expect(loaded).not.toHaveBeenCalled();
    expect(built).not.toHaveBeenCalled();
    expect(config.state.status).toBe("disconnected");
  });

  it("is skipped when another wallet was the last one used", async () => {
    const { config, loaded } = setup("io.metamask");
    await reconnect(config);
    expect(loaded).not.toHaveBeenCalled();
  });

  it("downloads its code and reconnects a returning visitor whose last wallet it was", async () => {
    const { config, loaded } = setup(META.id);
    await reconnect(config);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(config.state.status).toBe("connected");
    expect(config.state.connections.size).toBe(1);
  });

  it("downloads its code when the visitor connects with it, once, and remembers it as the last wallet", async () => {
    const { config, loaded, mem } = setup();
    const c = config.connectors.find((x) => x.id === META.id)!;
    const res = await connect(config, { connector: c });
    expect(res.accounts).toEqual([ME]);
    expect(loaded).toHaveBeenCalledTimes(1);
    expect(config.state.status).toBe("connected");
    expect(JSON.parse(mem.get("wagmi.recentConnectorId") ?? "null")).toBe(META.id);
    // Later calls reuse the loaded connector.
    expect(await c.getAccounts()).toEqual([ME]);
    expect(await c.getProvider()).toBeDefined();
    expect(loaded).toHaveBeenCalledTimes(1);
  });

  it("keeps `this` when it forwards connect and switchChain to the real connector", async () => {
    const { config } = setup();
    const c = config.connectors.find((x) => x.id === META.id)!;
    await expect(connect(config, { connector: c })).resolves.toBeDefined();
    await expect(c.switchChain!({ chainId: base.id })).resolves.toBeDefined();
  });

  it("disconnects cleanly, and a disconnect before anything loaded does not download it", async () => {
    const a = setup();
    await connect(a.config, { connector: a.config.connectors.find((x) => x.id === META.id)! });
    await disconnect(a.config);
    expect(a.config.state.status).toBe("disconnected");

    const b = setup();
    await b.config.connectors[0].disconnect();
    expect(b.loaded).not.toHaveBeenCalled();
  });
});
