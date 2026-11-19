export function isLocalEnvironmentDisabled() {
  return (
    typeof window !== "undefined" && window.desktopBridge?.getLocalEnvironmentEnabled() === false
  );
}
