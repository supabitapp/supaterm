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
import kotlin.test.assertNull
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
    private val replyToPings: Boolean = false,
    private val seed: ByteArray = ByteArray(32) { it.toByte() },
    private val welcomeDelayMillis: Long = 0
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
      val signature = Ed25519Sign(seed).sign(transcript)
      Thread.sleep(welcomeDelayMillis)
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

  private class HungUpWatcher : WebSocketListener() {
    val ended = CompletableFuture<Unit>()

    override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
      ended.complete(Unit)
    }

    override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
      ended.complete(Unit)
    }
  }

  private val MockWebServer.wsUrl get() = url("/").toString().replaceFirst("http", "ws")

  private fun withServers(count: Int, block: (List<MockWebServer>) -> Unit) {
    val servers = List(count) { MockWebServer() }
    try {
      block(servers)
    } finally {
      servers.forEach { it.close() }
    }
  }

  private fun host(seed: ByteArray = ByteArray(32) { it.toByte() }, welcomeDelayMillis: Long = 0) =
    MockResponse().withWebSocketUpgrade(
      SilentHost(
        unhex(vector.getString("identity")),
        seed = seed,
        welcomeDelayMillis = welcomeDelayMillis
      )
    )

  private fun LinkedBlockingQueue<Map<String, Any>>.await(
    predicate: (Map<String, Any>) -> Boolean
  ): Map<String, Any> {
    val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
    while (true) {
      val status = poll(deadline - System.nanoTime(), TimeUnit.NANOSECONDS)
      checkNotNull(status) { "Timed out waiting for a status" }
      if (predicate(status)) return status
    }
  }

  private fun raceTunnel(
    relay: MockWebServer,
    direct: List<MockWebServer>,
    statuses: LinkedBlockingQueue<Map<String, Any>> = LinkedBlockingQueue(),
    timing: NativeTunnel.Timing = NativeTunnel.Timing()
  ) =
    NativeTunnel(
      relay.wsUrl,
      vector.getString("address"),
      onStatus = { statuses.add(it) },
      timing = timing,
      directUrls = direct.map { it.wsUrl },
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

  @Test
  fun directCandidateWinsAndTheSilentRelayDialIsCancelled() = withServers(2) { (relay, direct) ->
    val watcher = HungUpWatcher()
    relay.enqueue(MockResponse().withWebSocketUpgrade(watcher))
    direct.enqueue(host())
    val statuses = LinkedBlockingQueue<Map<String, Any>>()
    raceTunnel(relay, listOf(direct), statuses).use { tunnel ->
      openStream(tunnel.origin).use {
        assertEquals("direct", statuses.await { it["state"] == "up" }["via"])
        watcher.ended.get(10, TimeUnit.SECONDS)
        assertEquals(1, relay.requestCount)
      }
    }
  }

  @Test
  fun relayFailureWaitsForAPendingDirectCandidate() = withServers(2) { (relay, direct) ->
    relay.enqueue(MockResponse().setResponseCode(404))
    direct.enqueue(host(welcomeDelayMillis = 200))
    val statuses = LinkedBlockingQueue<Map<String, Any>>()
    raceTunnel(relay, listOf(direct), statuses).use { tunnel ->
      openStream(tunnel.origin).use {
        assertEquals("direct", statuses.await { it["state"] == "up" }["via"])
      }
    }
  }

  @Test
  fun impostorAtADirectAddressLosesToTheRelay() = withServers(2) { (relay, impostor) ->
    relay.enqueue(host(welcomeDelayMillis = 200))
    impostor.enqueue(host(seed = ByteArray(32) { (it + 1).toByte() }))
    val statuses = LinkedBlockingQueue<Map<String, Any>>()
    raceTunnel(relay, listOf(impostor), statuses).use { tunnel ->
      openStream(tunnel.origin).use {
        assertEquals("relay", statuses.await { it["state"] == "up" }["via"])
        assertEquals(1, impostor.requestCount)
      }
    }
  }

  @Test
  fun answerWaitsForEveryCandidateAndKeepsTheRelayReason() = withServers(2) { (relay, direct) ->
    relay.enqueue(MockResponse().setResponseCode(404))
    direct.enqueue(silentUpgrade)
    val timing = NativeTunnel.Timing(directTimeoutMillis = 200)
    raceTunnel(relay, listOf(direct), timing = timing).use { tunnel ->
      val response = request(tunnel.origin)
      assertTrue(
        response.startsWith(
          "HTTP/1.1 503 Service Unavailable\r\nX-Supaterm-Relay-Error: host-offline\r\n"
        ),
        response,
      )
      assertEquals(1, direct.requestCount)
    }
  }

  @Test
  fun newCandidatesApplyToTheNextDialWithoutTearingDownTheSession() =
    withServers(3) { (relay, first, second) ->
      repeat(2) { relay.enqueue(silentUpgrade) }
      first.enqueue(host())
      second.enqueue(host())
      val statuses = LinkedBlockingQueue<Map<String, Any>>()
      raceTunnel(relay, listOf(first), statuses).use { tunnel ->
        openStream(tunnel.origin).use {
          assertEquals("direct", statuses.await { it["state"] == "up" }["via"])
          tunnel.setDirectUrls(listOf(second.wsUrl))
          tunnel.networkChanged()
          val dropped = statuses.await { it["state"] != "up" }
          assertEquals("down", dropped["state"])
          assertEquals("Network changed", dropped["reason"])
          assertNull(dropped["via"])
        }
        openStream(tunnel.origin).use {
          val redialed = statuses.await { it["state"] == "up" }
          assertEquals("direct", redialed["via"])
          assertEquals(2, redialed["sessionCount"])
          assertEquals(listOf(2, 1, 1), listOf(relay, first, second).map { it.requestCount })
        }
      }
    }

  @Test
  fun networkChangeKeepsARelaySession() = withServers(1) { (relay) ->
    relay.enqueue(host())
    val statuses = LinkedBlockingQueue<Map<String, Any>>()
    raceTunnel(relay, emptyList(), statuses).use { tunnel ->
      openStream(tunnel.origin).use {
        assertEquals("relay", statuses.await { it["state"] == "up" }["via"])
        tunnel.networkChanged()
        assertNull(statuses.poll(300, TimeUnit.MILLISECONDS)?.takeIf { it["state"] == "down" })
      }
    }
  }
}
