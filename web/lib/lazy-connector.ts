import { createConnector, type CreateConnectorFn } from "wagmi";

type Real = ReturnType<CreateConnectorFn>;
type Params = Parameters<CreateConnectorFn>[0];

/** What the wallet list shows and wagmi matches on; it must equal the real connector's own values. */
export interface LazyMeta {
  id: string;
  name: string;
  type: string;
  rdns?: string;
}

/**
 * A wagmi connector whose real code (WalletConnect's and Coinbase's SDKs, hundreds of KB) is fetched only when needed: when the
 * visitor connects with it, or when it was the last wallet used (so a returning visitor is reconnected as before).
 *
 * Without this, wagmi's reconnect asks every connector for its provider on each page load, which downloads and starts those SDKs for
 * everyone, including visitors who never connect a wallet (about 350 KB of the 670 KB the page fetched on 2026-10-30).
 * `getProvider` throws until the real connector is loaded, which is how reconnect skips a connector.
 */
export function lazyConnector(meta: LazyMeta, load: () => Promise<CreateConnectorFn>): CreateConnectorFn {
  return createConnector((params: Params) => {
    let real: Real | undefined;
    let loading: Promise<Real> | undefined;
    const ensure = (): Promise<Real> =>
      (loading ??= load().then((factory) => {
        real = factory(params);
        return real;
      }));
    const wasUsed = async () => {
      try {
        return (await params.storage?.getItem("recentConnectorId")) === meta.id;
      } catch {
        return false;
      }
    };
    return {
      ...meta,
      async setup() {
        if (await wasUsed()) await (await ensure()).setup?.();
      },
      async connect(p?: unknown) {
        const r = await ensure();
        await r.setup?.();
        // A method call, not a detached function: the real connectors call `this.getProvider()` and friends.
        return r.connect.call(r, p as never);
      },
      async disconnect() {
        await real?.disconnect();
      },
      async getAccounts() {
        return (await ensure()).getAccounts();
      },
      async getChainId() {
        return (await ensure()).getChainId();
      },
      async getProvider(p?: unknown) {
        if (!real && !(await wasUsed())) throw new Error(`${meta.name} is not loaded yet`);
        return (await ensure()).getProvider(p as never);
      },
      async isAuthorized() {
        if (!real && !(await wasUsed())) return false;
        return (await ensure()).isAuthorized();
      },
      async switchChain(p: unknown) {
        const r = await ensure();
        if (!r.switchChain) throw new Error(`${meta.name} cannot switch chains`);
        return r.switchChain.call(r, p as never);
      },
      onAccountsChanged(accounts: string[]) {
        real?.onAccountsChanged(accounts);
      },
      onChainChanged(chainId: string) {
        real?.onChainChanged(chainId);
      },
      onDisconnect(error?: Error) {
        real?.onDisconnect(error);
      },
    } as unknown as Real;
  });
}
