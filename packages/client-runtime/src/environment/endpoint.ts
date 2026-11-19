export * from "@supaterm/shared/advertisedEndpoint";

export const environmentEndpointUrl: (httpBaseUrl: string, pathname: string) => string = (
  httpBaseUrl: string,
  pathname: string,
) => {
  const url = new URL(httpBaseUrl);
  url.pathname = pathname;
  url.search = "";
  url.hash = "";
  return url.toString();
};
