export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const asset = url.pathname.startsWith("/static/") || url.pathname.startsWith("/array/");
    url.hostname = asset ? "us-assets.i.posthog.com" : "us.i.posthog.com";
    url.protocol = "https:";
    url.port = "";

    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    headers.delete("host");
    headers.set("X-Forwarded-For", request.headers.get("CF-Connecting-IP") ?? "");

    return fetch(
      new Request(url, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? null
            : await request.arrayBuffer(),
        redirect: "manual",
        ...(!asset ? { cache: "no-store" } : {}),
      }),
    );
  },
};
