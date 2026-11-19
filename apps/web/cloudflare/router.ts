export async function routeRequest(request: Request, upstreamFetch: typeof fetch) {
  const url = new URL(request.url);
  if (url.pathname === "/__supaterm/channel") {
    const channel = url.searchParams.get("channel") === "nightly" ? "nightly" : "latest";
    return new Response(null, {
      status: 302,
      headers: {
        Location: "/",
        "Set-Cookie": `supaterm_web_channel=${channel}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`,
        "Cache-Control": "no-store",
      },
    });
  }

  const nightly = request.headers
    .get("Cookie")
    ?.split(";")
    .some((cookie) => cookie.trim() === "supaterm_web_channel=nightly");
  url.hostname = nightly ? "nightly.app.supaterm.com" : "latest.app.supaterm.com";
  url.protocol = "https:";
  url.port = "";
  const upstream = await upstreamFetch(new Request(url, request), { redirect: "manual" });
  const response = new Response(upstream.body, upstream);
  response.headers.append("Vary", "Cookie");
  response.headers.set("Cache-Control", "private, no-cache");
  return response;
}

export default {
  fetch: (request: Request) => routeRequest(request, fetch),
};
