// @effect-diagnostics nodeBuiltinImport:off - exercises the production tunnel against Node HTTP parsing without opening a listener.
import * as NodeHttp from "node:http";
import { TunnelSocket } from "@supaterm/shared/relay/tunnelNode";
import { describe, expect, it } from "vite-plus/test";
import {
  acceptClientHandshake,
  createClientHandshake,
  relayHttpBaseUrl,
  relayPublicKey,
} from "@supaterm/shared/relay/protocol";
import { createTunnelSession } from "@supaterm/shared/relay/tunnel";
import { createGuestTransport } from "./guestTransport";

const encode = new TextEncoder();
const decode = new TextDecoder();
const random = (size: number) => crypto.getRandomValues(new Uint8Array(size));

function fixture(response: string | Uint8Array | NodeHttp.Server) {
  const secret = random(32);
  const handshake = createClientHandshake(relayPublicKey(secret), random);
  const accepted = acceptClientHandshake(handshake.hello, secret, random);
  const requests: string[] = [];
  const wire: Uint8Array[] = [];
  const host = createTunnelSession({
    initiator: false,
    cipher: accepted.cipher,
    send(bytes) {
      wire.push(bytes);
      queueMicrotask(() => client.receive(bytes));
    },
    onStream(stream) {
      if (response instanceof NodeHttp.Server) {
        response.emit("connection", new TunnelSocket(stream));
        return;
      }
      const chunks: Uint8Array[] = [];
      let received = 0;
      let expected: number | undefined;
      stream.onData = (bytes) => {
        chunks.push(bytes);
        received += bytes.length;
        stream.consumed(bytes.length);
        if (expected === undefined) {
          const head = decode.decode(bytes);
          const headerEnd = head.indexOf("\r\n\r\n");
          if (headerEnd >= 0)
            expected = headerEnd + 4 + Number(/content-length: (\d+)/.exec(head)?.[1]);
        }
        if (received !== expected) return;
        requests.push(Buffer.concat(chunks).toString("utf8"));
        stream.write(typeof response === "string" ? encode.encode(response) : response);
        stream.end();
      };
    },
  });
  const client = createTunnelSession({
    initiator: true,
    cipher: handshake.finish(accepted.welcome),
    send(bytes) {
      wire.push(bytes);
      queueMicrotask(() => host.receive(bytes));
    },
  });
  const transport = createGuestTransport(
    { address: relayHttpBaseUrl(relayPublicKey(secret)), relayUrl: "wss://relay.example" },
    "guest-token",
    () => ({
      open: async () => client.open(),
      session: async () => client,
      close: () => {
        client.close();
        host.close();
      },
    }),
  );
  return { transport, requests, wire };
}

describe("encrypted guest HTTP", () => {
  it("carries the guest capability only inside the verified encrypted tunnel", async () => {
    const { transport, requests, wire } = fixture(
      "HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello",
    );
    try {
      const response = await transport.request("/api/guest/session?share=one");
      expect(await response.text()).toBe("hello");
      expect(requests[0]).toContain("authorization: Bearer guest-token\r\n");
      expect(requests[0]).toContain("GET /api/guest/session?share=one HTTP/1.1");
      expect(wire.every((bytes) => !decode.decode(bytes).includes("guest-token"))).toBe(true);
      expect(wire.every((bytes) => !decode.decode(bytes).includes("/api/guest"))).toBe(true);
    } finally {
      transport.close();
    }
  });

  it("streams chunked events and rejects owner routes before opening a stream", async () => {
    const { transport, requests } = fixture(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nContent-Type: text/event-stream\r\n\r\n9\r\ndata: x\n\n\r\n0\r\n\r\n",
    );
    try {
      const response = await transport.request("/api/guest/stream?share=one");
      expect(await response.text()).toBe("data: x\n\n");
      for (const path of [
        "/ws",
        "/api/auth",
        "/api/guest/../auth",
        "https://other.example/api/guest/session",
      ]) {
        await expect(transport.request(path)).rejects.toThrow("not available to guests");
      }
      expect(requests).toHaveLength(1);
    } finally {
      transport.close();
    }
  });

  it("posts multipart files inside the tunnel and returns binary media unchanged", async () => {
    const { transport, requests } = fixture(
      new Uint8Array([
        ...encode.encode("HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n"),
        0,
        255,
        128,
        13,
      ]),
    );
    try {
      const body = new FormData();
      body.append("file", new File(["content"], "notes.txt", { type: "text/plain" }));
      const response = await transport.request("/api/guest/messages?share=one", {
        method: "POST",
        body,
      });
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array([0, 255, 128, 13]),
      );
      expect(requests[0]).toContain("multipart/form-data; boundary=");
      expect(requests[0]).toContain('filename="notes.txt"');
    } finally {
      transport.close();
    }
  });

  it("sends the permitted 10 MB upload without overflowing the tunnel queue", async () => {
    const { transport, requests } = fixture("HTTP/1.1 204 No Content\r\n\r\n");
    try {
      const body = new FormData();
      body.append("file", new File([new Uint8Array(10 * 1024 * 1024)], "large.bin"));
      const response = await transport.request("/api/guest/messages?share=one", {
        method: "POST",
        body,
      });
      expect(response.status).toBe(204);
      expect(requests[0]!.length).toBeGreaterThan(10 * 1024 * 1024);
    } finally {
      transport.close();
    }
  });

  it("rejects oversized response headers and invalid chunks", async () => {
    for (const response of [
      "HTTP/1.1 200 OK\r\nX: " + "a".repeat(17_000),
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzzz\r\n",
    ]) {
      const { transport } = fixture(response);
      try {
        await expect(
          transport.request("/api/guest/session").then((result) => result.text()),
        ).rejects.toThrow();
      } finally {
        transport.close();
      }
    }
  });
});

it("redeems a guest through the production tunnel and Node HTTP body reader", async () => {
  const submissions: unknown[] = [];
  const failures: unknown[] = [];
  const server = NodeHttp.createServer((request, response) => {
    void (async () => {
      if (request.method === "GET") {
        response.writeHead(403);
        response.end();
        return;
      }
      const chunks: Uint8Array[] = [];
      for await (const chunk of request) chunks.push(chunk);
      submissions.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ joined: true }));
    })().catch((error: unknown) => {
      failures.push(error);
      response.destroy();
    });
  });
  const { transport } = fixture(server);
  try {
    expect((await transport.request("/api/guest/session?share=test")).status).toBe(403);
    const response = await transport.request("/api/guest/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: "fixture-invite", name: "Local verification guest" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ joined: true });
    expect(submissions).toEqual([
      { credential: "fixture-invite", name: "Local verification guest" },
    ]);
    expect(failures).toEqual([]);
  } finally {
    transport.close();
    server.close();
  }
});
