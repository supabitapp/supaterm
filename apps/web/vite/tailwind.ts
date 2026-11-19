import tailwindcss from "@tailwindcss/vite";

export function tailwindPlugins(bundledDev: boolean) {
  const plugins = tailwindcss();
  if (bundledDev) {
    for (const plugin of plugins) {
      delete plugin.hotUpdate;
    }
  }
  return plugins;
}
