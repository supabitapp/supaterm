/** Credentials for media requests that cannot set bearer headers. */
export interface DeviceHubAccess {
  readonly httpBase: string;
  readonly wsBase: string;
  /** Empty for cookie sessions; includes a short-lived ticket for bearer sessions. */
  readonly query: Readonly<Record<string, string>>;
  readonly credentials: boolean;
}

export const withDeviceHubQuery = (url: string, access: DeviceHubAccess): string => {
  const entries = Object.entries(access.query);
  if (entries.length === 0) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}${new URLSearchParams(entries).toString()}`;
};
