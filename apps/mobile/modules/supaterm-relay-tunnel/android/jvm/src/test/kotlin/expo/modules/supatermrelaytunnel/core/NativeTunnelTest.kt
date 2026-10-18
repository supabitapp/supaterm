package expo.modules.supatermrelaytunnel.core

import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.X25519
import java.io.File
import java.util.concurrent.CompletableFuture
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import org.junit.Test

private fun ByteArray.frameTypes(): List<Int> {
  val types = mutableListOf<Int>()
  var offset = 0
  while (offset + 9 <= size) {
    types.add(this[offset].toInt())
    offset += 9 + java.nio.ByteBuffer.wrap(this, offset + 5, 4).int
  }
  return types
}

class NativeTunnelTest {
  private val vector = JSONObject(File("fixtures/vectors.json").readText())

  private class SilentHost(
    private val identity: ByteArray,
    private val replyToPings: Boolean = false
  ) : WebSocketListener() {
    private val secret = ByteArray(32) { (it + 64).toByte() }
    private var cipher: RelayCipher? = null
    val records = LinkedBlockingQueue<ByteArray>()

    private fun hmac(key: ByteArray, bytes: ByteArray) =
      Mac.getInstance("HmacSHA256").run {
        init(SecretKeySpec(key, "HmacSHA256"))
        doFinal(bytes)
      }

    override fun onMessage(webSocket: WebSocket, text: String) {
      val client = unb64(JSONObject(text).getString("key"))
      val key = X25519.publicFromPrivate(secret)
      val transcript = "supaterm-tunnel-v2\n".toByteArray() + identity + client + key
      val prk = hmac(sha256(transcript), X25519.computeSharedSecret(secret, client))
      val info = "supaterm-tunnel-traffic-v1".toByteArray()
      val clientKey = hmac(prk, info + byteArrayOf(1))
      cipher = RelayCipher(hmac(prk, clientKey + info + byteArrayOf(2)), clientKey)
      val signature = Ed25519Sign(ByteArray(32) { it.toByte() }).sign(transcript)
      webSocket.send(
        JSONObject()
          .put("type", "welcome")
          .put("version", 2)
          .put("key", b64(key))
          .put("signature", b64(signature))
          .toString()
      )
    }

    override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
      cipher?.let {
        val record = it.open(bytes.toByteArray())
        records.add(record)
        if (replyToPings && 6 in record.frameTypes()) {
          webSocket.send(it.seal(TunnelMux.frame(7, 0)).toByteString())
        }
      }
    }
  }

  private fun openStream(value: String): java.net.Socket {
    val origin = java.net.URI(value)
    return java.net.Socket(origin.host, origin.port).apply {
      getOutputStream().write(
        "GET / HTTP/1.1\r\nHost: ${origin.host}:${origin.port}\r\n\r\n".toByteArray()
      )
    }
  }

  private fun request(value: String): String =
    openStream(value).use { socket ->
      socket.soTimeout = 5_000
      socket.getInputStream().readBytes().toString(Charsets.ISO_8859_1)
    }

  private fun LinkedBlockingQueue<ByteArray>.awaitPing() {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
    while (true) {
      val record = poll(deadline - System.nanoTime(), TimeUnit.NANOSECONDS)
      checkNotNull(record) { "Timed out waiting for a ping" }
      if (6 in record.frameTypes()) return
    }
  }

  private fun inBackground(block: () -> String) =
    java.util.concurrent.FutureTask(block).also { Thread(it).start() }

  private fun MockWebServer.assertNoDialWithin(millis: Long, expectedRequests: Int) {
    Thread.sleep(millis)
    assertEquals(expectedRequests, requestCount)
  }

  private fun tunnelFor(
    server: MockWebServer,
    timing: NativeTunnel.Timing = NativeTunnel.Timing()
  ) =
    NativeTunnel(
      server.url("/").toString().replaceFirst("http", "ws"),
      vector.getString("address"),
      timing = timing,
    )

  private val silentUpgrade get() = MockResponse().withWebSocketUpgrade(
    object : WebSocketListener() {}
  )

  @Test
  fun offlineHostAnswersEveryWaitingRequestFromOneDial() {
    MockWebServer().use { server ->
      server.enqueue(MockResponse().setResponseCode(404))
      tunnelFor(server).use { tunnel ->
        tunnel.resume()
        val responses = List(3) { inBackground { request(tunnel.origin) } }
          .map { it.get(10, TimeUnit.SECONDS) } + request(tunnel.origin)
        for (response in responses) {
          assertTrue(
            response.startsWith(
              "HTTP/1.1 503 Service Unavailable\r\nX-Supaterm-Relay-Error: host-offline\r\n"
            ),
            response,
          )
        }
        assertEquals(1, server.requestCount)
      }
    }
  }

  @Test
  fun requestAfterTheFailureCooldownDialsAgain() {
    MockWebServer().use { server ->
      repeat(2) { server.enqueue(MockResponse().setResponseCode(404)) }
      tunnelFor(server, NativeTunnel.Timing(failureCooldownMillis = 100)).use { tunnel ->
        request(tunnel.origin)
        Thread.sleep(200)
        assertTrue("X-Supaterm-Relay-Error: host-offline" in request(tunnel.origin))
        assertEquals(2, server.requestCount)
      }
    }
  }

  @Test
  fun relayRejectionsMapToLocalGatewayAnswers() {
    for ((status, expected) in listOf(
      429 to "HTTP/1.1 503 Service Unavailable\r\nX-Supaterm-Relay-Error: relay-busy",
      503 to "HTTP/1.1 503 Service Unavailable\r\nX-Supaterm-Relay-Error: relay-busy",
      500 to "HTTP/1.1 502 Bad Gateway\r\nX-Supaterm-Relay-Error: relay-unreachable",
    )) {
      MockWebServer().use { server ->
        server.enqueue(MockResponse().setResponseCode(status))
        tunnelFor(server).use { tunnel ->
          val response = request(tunnel.origin)
          assertTrue(response.startsWith(expected), "$status: $response")
        }
      }
    }
  }

  @Test
  fun hostThatNeverAnswersThePairingReportsOffline() {
    MockWebServer().use { server ->
      server.enqueue(
        MockResponse().withWebSocketUpgrade(
          object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
              webSocket.close(1013, "pair timeout")
            }
          }
        )
      )
      tunnelFor(server).use { tunnel ->
        val response = request(tunnel.origin)
        assertTrue(response.startsWith("HTTP/1.1 503 Service Unavailable\r\n"), response)
        assertTrue("X-Supaterm-Relay-Error: host-offline\r\n" in response, response)
      }
    }
  }

  @Test
  fun handshakeTimeoutAnswersWithGatewayTimeout() {
    MockWebServer().use { server ->
      server.enqueue(silentUpgrade)
      tunnelFor(server, NativeTunnel.Timing(handshakeTimeoutMillis = 200)).use { tunnel ->
        val response = request(tunnel.origin)
        assertTrue(
          response.startsWith(
            "HTTP/1.1 504 Gateway Timeout\r\nX-Supaterm-Relay-Error: relay-timeout\r\n"
          ),
          response,
        )
      }
    }
  }

  @Test
  fun foregroundAnswersAStaleHandshakeAndTheNextRequestDials() {
    MockWebServer().use { server ->
      repeat(2) { server.enqueue(silentUpgrade) }
      tunnelFor(server).use { tunnel ->
        val pending = inBackground { request(tunnel.origin) }
        checkNotNull(server.takeRequest(10, TimeUnit.SECONDS))
        tunnel.resume()
        val response = pending.get(10, TimeUnit.SECONDS)
        assertTrue(
          response.startsWith(
            "HTTP/1.1 502 Bad Gateway\r\nX-Supaterm-Relay-Error: relay-unreachable\r\n"
          ),
          response,
        )
        openStream(tunnel.origin).use { checkNotNull(server.takeRequest(10, TimeUnit.SECONDS)) }
      }
    }
  }

  @Test
  fun foregroundCancelsBackgroundCloseAndKeepsResponsiveSession() {
    val host = SilentHost(unhex(vector.getString("identity")), replyToPings = true)
    MockWebServer().use { server ->
      server.enqueue(MockResponse().withWebSocketUpgrade(host))
      val connected = CompletableFuture<Map<String, Any>>()
      val down = CompletableFuture<Map<String, Any>>()
      NativeTunnel(
        server.url("/").toString().replaceFirst("http", "ws"),
        vector.getString("address"),
        onStatus = {
          if (it["state"] == "up") {
            connected.complete(it)
          }
          if (it["reason"] != null) down.complete(it)
        },
      ).use { tunnel ->
        openStream(tunnel.origin).use {
          connected.get(10, TimeUnit.SECONDS)
          tunnel.background(100)
          tunnel.resume(300)
          host.records.awaitPing()
          assertFailsWith<java.util.concurrent.TimeoutException> {
            down.get(600, TimeUnit.MILLISECONDS)
          }
          assertEquals(1, server.requestCount)
          assertEquals(1, connected.get()["sessionCount"])
        }
      }
    }
  }

  @Test
  fun backgroundGraceClosesTheSessionAndTheNextRequestReconnects() {
    MockWebServer().use { server ->
      repeat(2) {
        server.enqueue(
          MockResponse().withWebSocketUpgrade(SilentHost(unhex(vector.getString("identity"))))
        )
      }
      val connected = CompletableFuture<Unit>()
      val down = CompletableFuture<Unit>()
      val reconnected = CompletableFuture<Unit>()
      NativeTunnel(
        server.url("/").toString().replaceFirst("http", "ws"),
        vector.getString("address"),
        onStatus = {
          if (it["state"] == "up") {
            connected.complete(Unit)
            if (it["sessionCount"] == 2) {
              reconnected.complete(Unit)
            }
          }
          if (it["reason"] == "Backgrounded") down.complete(Unit)
        },
      ).use { tunnel ->
        openStream(tunnel.origin).use {
          connected.get(10, TimeUnit.SECONDS)
          tunnel.background(100)
          down.get(10, TimeUnit.SECONDS)
        }
        assertLoopbackClosed(tunnel.origin)
        assertEquals(1, server.requestCount)
        tunnel.resume()
        server.assertNoDialWithin(300, expectedRequests = 1)
        openStream(tunnel.origin).use { reconnected.get(10, TimeUnit.SECONDS) }
      }
    }
  }

  private fun assertLoopbackClosed(value: String) {
    openStream(value).use { socket ->
      socket.soTimeout = 5_000
      val closed = try {
        socket.getInputStream().read() == -1
      } catch (_: java.net.SocketException) {
        true
      }
      assertTrue(closed)
    }
  }

  @Test
  fun foregroundProbeDropsASilentSessionWithoutRedialing() {
    MockWebServer().use { server ->
      repeat(2) {
        server.enqueue(
          MockResponse().withWebSocketUpgrade(SilentHost(unhex(vector.getString("identity"))))
        )
      }
      val connected = CompletableFuture<Unit>()
      val failed = CompletableFuture<Unit>()
      val reconnected = CompletableFuture<Unit>()
      NativeTunnel(
        server.url("/").toString().replaceFirst("http", "ws"),
        vector.getString("address"),
        onStatus = {
          if (it["state"] == "up") {
            connected.complete(Unit)
            if (it["sessionCount"] == 2) {
              reconnected.complete(Unit)
            }
          }
          if (it["reason"] == "Relay resume probe timed out") failed.complete(Unit)
        },
      ).use { tunnel ->
        openStream(tunnel.origin).use {
          connected.get(10, TimeUnit.SECONDS)
          tunnel.resume(100)
          failed.get(10, TimeUnit.SECONDS)
        }
        server.assertNoDialWithin(300, expectedRequests = 1)
        openStream(tunnel.origin).use { reconnected.get(10, TimeUnit.SECONDS) }
        assertEquals(2, server.requestCount)
      }
    }
  }

  @Test
  fun idleSessionPingsThenClosesAfterThreeMissedTicks() {
    val host = SilentHost(unhex(vector.getString("identity")))
    MockWebServer().use { server ->
      server.enqueue(MockResponse().withWebSocketUpgrade(host))
      val down = CompletableFuture<Map<String, Any>>()
      NativeTunnel(
        server.url("/").toString().replaceFirst("http", "ws"),
        vector.getString("address"),
        onStatus = { if (it["reason"] == "Relay session timed out") down.complete(it) },
        timing = NativeTunnel.Timing(keepaliveMillis = 50),
      ).use { tunnel ->
        openStream(tunnel.origin).use {
          host.records.awaitPing()
          assertEquals("down", down.get(10, TimeUnit.SECONDS)["state"])
        }
      }
    }
  }
}
