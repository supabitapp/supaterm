import { useEffect, useRef, useState } from "react";
import { useGuestTransport } from "./GuestTransportContext";

const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_CACHED_BYTES = 64 * 1024 * 1024;
const MAX_CACHED_ASSETS = 128;

export function useGuestAssets(paths: ReadonlyArray<string>) {
  const transport = useGuestTransport();
  const cache = useRef(new Map<string, { readonly url: string; readonly bytes: number }>());
  const [assets, setAssets] = useState<ReadonlyMap<string, string>>(new Map());
  const key = JSON.stringify([...new Set(paths)].slice(-MAX_CACHED_ASSETS));
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- fetches newly visible encrypted resources while retaining existing blob URLs across streamed updates
  useEffect(() => {
    const abort = new AbortController();
    const requested = new Set(JSON.parse(key) as string[]);
    for (const [path, resource] of cache.current) {
      if (requested.has(path)) continue;
      URL.revokeObjectURL(resource.url);
      cache.current.delete(path);
    }
    const publish = () =>
      setAssets(new Map([...cache.current].map(([path, asset]) => [path, asset.url])));
    const pending = [...requested].filter((path) => !cache.current.has(path));
    const load = async () => {
      while (pending.length > 0 && !abort.signal.aborted) {
        const path = pending.shift()!;
        try {
          const response = await transport.request(path, { signal: abort.signal });
          if (!response.ok) continue;
          const blob = await response.blob();
          if (abort.signal.aborted) return;
          if (blob.size > MAX_ASSET_BYTES) continue;
          let bytes = [...cache.current.values()].reduce((total, asset) => total + asset.bytes, 0);
          for (const [oldPath, asset] of cache.current) {
            if (bytes + blob.size <= MAX_CACHED_BYTES) break;
            bytes -= asset.bytes;
            URL.revokeObjectURL(asset.url);
            cache.current.delete(oldPath);
          }
          cache.current.set(path, { url: URL.createObjectURL(blob), bytes: blob.size });
          publish();
        } catch {
          if (abort.signal.aborted) return;
        }
      }
    };
    publish();
    for (let worker = 0; worker < 4; worker++) void load();
    return () => abort.abort();
  }, [key, transport]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- revokes all remaining guest resource URLs when the view unmounts
  useEffect(
    () => () => {
      for (const resource of cache.current.values()) URL.revokeObjectURL(resource.url);
      cache.current.clear();
    },
    [],
  );
  return assets;
}
