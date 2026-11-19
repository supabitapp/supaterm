module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.name === "@voidzero-dev/vite-plus-core" && pkg.peerDependencies?.typescript) {
        pkg.peerDependencies.typescript = "*";
      }
      return pkg;
    },
    updateConfig(config) {
      // oxlint-disable-next-line supaterm/no-global-process-runtime -- pnpm loads this file before any Effect runtime exists.
      if (process.platform !== "win32") return config;
      return {
        ...config,
        supportedArchitectures: {
          os: ["current", "linux"],
          cpu: ["current", "x64"],
          libc: ["current", "glibc"],
        },
      };
    },
  },
};
