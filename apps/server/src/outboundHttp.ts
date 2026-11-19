import * as NodeModule from "node:module";
import * as NodeNet from "node:net";

import type * as Undici from "undici";

const requireUndici = NodeModule.createRequire(import.meta.url);

/**
 * Node 26 bundles undici 8, which offers h2 over ALPN to every HTTPS origin.
 * Node 22/24 (and Electron) bundle undici 6/7, whose fetch stays on HTTP/1.1.
 */
export const builtinFetchUsesHttp2 = (bundledUndiciVersion: string | undefined) =>
  Number.parseInt(bundledUndiciVersion ?? "", 10) >= 8;

/**
 * Node's `--use-env-proxy` / `NODE_USE_ENV_PROXY` installs an
 * `EnvHttpProxyAgent` at startup; that choice is kept so proxies still apply.
 */
export function installHttp1FetchDispatcher() {
  const undici = requireUndici("undici") as typeof Undici;
  const usesEnvProxy = undici.getGlobalDispatcher().constructor.name === "EnvHttpProxyAgent";
  undici.setGlobalDispatcher(
    usesEnvProxy
      ? new undici.EnvHttpProxyAgent({
          allowH2: false,
          clientFactory: (origin) => new undici.Pool(origin, { allowH2: false }),
        })
      : new undici.Agent({ allowH2: false }),
  );
}

/**
 * An undici HTTP/2 session that hits its idle timeout can emit `'error'` on a
 * stream with no listener, which Node turns into an uncaught exception that
 * exits the server (https://github.com/nodejs/undici/issues/5936).
 */
export function keepOutboundFetchOnHttp1() {
  if (builtinFetchUsesHttp2(process.versions.undici)) installHttp1FetchDispatcher();
}

type TypeOfServiceSocket = {
  setTypeOfService?: (this: NodeNet.Socket, typeOfService: number) => NodeNet.Socket;
};

export function ignoreMacosTypeOfServiceEinval(
  // oxlint-disable-next-line supaterm/no-global-process-runtime -- Runs before ACP dispatch without loading the Effect graph.
  platform = process.platform,
  socketPrototype: TypeOfServiceSocket = NodeNet.Socket.prototype as TypeOfServiceSocket,
) {
  if (platform !== "darwin") return;
  const setTypeOfService = socketPrototype.setTypeOfService;
  if (typeof setTypeOfService !== "function") return;
  socketPrototype.setTypeOfService = function (...args) {
    try {
      return setTypeOfService.apply(this, args);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EINVAL") return this;
      throw error;
    }
  };
}

export function extendConnectionAttemptTimeout() {
  NodeNet.setDefaultAutoSelectFamilyAttemptTimeout(
    Math.max(NodeNet.getDefaultAutoSelectFamilyAttemptTimeout(), 1_000),
  );
}
