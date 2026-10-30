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

function fixture(response: string | Uint8Array) {
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
      const chunks: string[] = [];
      stream.onData = (bytes) => {
        chunks.push(decode.decode(bytes));
        stream.consumed(bytes.length);
      };
      stream.onEnd = () => {
        requests.push(chunks.join(""));
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
