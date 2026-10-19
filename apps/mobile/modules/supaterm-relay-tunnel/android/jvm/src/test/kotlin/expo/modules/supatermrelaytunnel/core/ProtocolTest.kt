package expo.modules.supatermrelaytunnel.core

import java.io.BufferedInputStream
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeoutException
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertFails
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.json.JSONObject
import org.junit.Test

class ProtocolTest {
  private fun vector() = JSONObject(File("fixtures/vectors.json").readText())

  @Test
  fun stripsCookiesOnEveryRequestWithoutChangingHeadersOrBodies() {
    val first = "POST /upload HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n" +
      "Authorization: Bearer synthetic\r\nX-Name: café\r\nContent-Length: 3\r\n"
    val second = "POST /next HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nTransfer-Encoding: chunked\r\n"
    val input =
      first + "cOoKiE: first=secret\r\nCookie: second=secret\r\nCOOKIE2: old=secret\r\n\r\nabc" +
        second + "Cookie: third=secret\r\n\r\n3\r\nxyz\r\n0\r\n\r\n"
    val expected = first + "\r\nabc" + second + "\r\n3\r\nxyz\r\n0\r\n\r\n"
    val output = ByteArrayOutputStream()
    LoopbackHttp.pipe(
      BufferedInputStream(ByteArrayInputStream(input.toByteArray(Charsets.ISO_8859_1)), 1),
      "127.0.0.1:1234",
      CompletableFuture(),
      output::write,
    )
    assertContentEquals(expected.toByteArray(Charsets.ISO_8859_1), output.toByteArray())
  }

  @Test
  fun stripsUpgradeCookiesBeforeForwardingOpaquePayload() {
    val head = "GET /ws HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nUpgrade: websocket\r\n"
    val payload = byteArrayOf(0x82.toByte(), 3, 1, 2, 3)
    val input =
      (head + "Cookie: session=secret\r\nCookie2: old=secret\r\n\r\n").toByteArray() + payload
    val output = ByteArrayOutputStream()
    LoopbackHttp.pipe(
      BufferedInputStream(ByteArrayInputStream(input)),
      "127.0.0.1:1234",
      CompletableFuture.completedFuture(true),
      output::write,
    )
    assertContentEquals((head + "\r\n").toByteArray() + payload, output.toByteArray())
  }

  @Test
  fun nodeKnownAnswersForPlatformAndFallback() {
    for (fallback in listOf(false, true)) {
      val v = vector()
      val handshake =
        ClientHandshake(
          unhex(v.getString("identity")),
          unhex(v.getString("clientSecret")),
          CurveCrypto(fallback),
        )
      assertEquals(
        JSONObject(v.getString("hello")).getString("key"),
        JSONObject(handshake.hello).getString("key"),
      )
      assertContentEquals(
        unhex(v.getString("identity")),
        parseRelayIdentity(v.getString("address") + "pair#token=unused"),
      )
      assertContentEquals(
        unhex(v.getString("identity")),
        parseRelayIdentity(v.getString("address").replace(".alt/", ".invalid/")),
      )
      val transcript =
        "supaterm-tunnel-v2\n".toByteArray() +
          unhex(v.getString("identity")) +
          unb64(JSONObject(handshake.hello).getString("key")) +
          unb64(JSONObject(v.getString("welcome")).getString("key"))
      assertEquals(v.getString("transcript"), transcript.hex())
      val cipher = handshake.finish(v.getString("welcome"))
      val records = v.getJSONArray("records")
      for (index in 0 until records.length()) {
        val record = records.getJSONObject(index)
        assertEquals(
          record.getString("client"),
          cipher.seal(unhex(record.getString("plain"))).hex(),
        )
        assertEquals(record.getString("plain"), cipher.open(unhex(record.getString("host"))).hex())
      }
      assertFails { cipher.open(unhex(records.getJSONObject(0).getString("host"))) }
      cipher.destroy()
      assertFails { cipher.seal(byteArrayOf(1)) }
    }
  }

  @Test
  fun rejectsIdentityVersionAndAuthenticationChanges() {
    val v = vector()
    for (fallback in listOf(false, true)) {
      for (change in listOf("identity", "version", "key", "signature")) {
        val identity = unhex(v.getString("identity"))
        if (change == "identity") identity[0] = (identity[0].toInt() xor 1).toByte()
        val welcome = JSONObject(v.getString("welcome"))
        if (change == "version") welcome.put("version", 1)
        if (change == "key" || change == "signature") {
          val bytes = unb64(welcome.getString(change))
          bytes[0] = (bytes[0].toInt() xor 1).toByte()
          welcome.put(change, b64(bytes))
        }
        assertFails {
          ClientHandshake(identity, unhex(v.getString("clientSecret")), CurveCrypto(fallback))
            .finish(welcome.toString())
        }
      }
      assertFails { CurveCrypto(fallback).shared(ByteArray(32) { 42 }, ByteArray(32)) }
    }
    val cipher =
      ClientHandshake(unhex(v.getString("identity")), unhex(v.getString("clientSecret")))
        .finish(v.getString("welcome"))
    val frame = unhex(v.getJSONArray("records").getJSONObject(0).getString("host"))
    frame[frame.lastIndex] = (frame.last().toInt() xor 1).toByte()
    assertFails { cipher.open(frame) }
    assertFails { cipher.open(ByteArray(65561)) }
  }

  private fun cipher() = RelayCipher(ByteArray(32) { 1 }, ByteArray(32) { 1 })

  private fun frameHeaders(plain: ByteArray): List<Pair<Int, Int>> {
    val buffer = ByteBuffer.wrap(plain)
    val frames = ArrayList<Pair<Int, Int>>()
    while (buffer.hasRemaining()) {
      val type = buffer.get().toInt()
      val id = buffer.int
      val size = buffer.int
      buffer.position(buffer.position() + size)
      frames.add(type to id)
    }
    return frames
  }

  @Test
  fun sendsOpenBeforeDataAndFin() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = cipher()
    val stream = mux.open({}, {}, {})
    val sent = CompletableFuture<Unit>()
    mux.write(stream, ByteArray(100), sent)
    mux.end(stream)
    mux.pump()
    assertEquals(
      listOf(1 to stream.id, 2 to stream.id, 4 to stream.id),
      frameHeaders(peer.open(emitted.single()))
    )
    assertTrue(sent.isDone)
  }

  @Test
  fun givesEachSaturatedStreamATurnBeforeDrainingTheFirst() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = cipher()
    val streams = List(3) { mux.open({}, {}, {}) }
    val sent = streams.map { stream ->
      CompletableFuture<Unit>().also { mux.write(stream, ByteArray(TunnelMux.MAX_PLAIN), it) }
    }
    mux.pump()
    val dataStreams = emitted.flatMap { frameHeaders(peer.open(it)) }
      .filter { it.first == 2 }.map { it.second }
    assertEquals(streams.map { it.id }, dataStreams.take(3))
    assertTrue(sent.all { it.isDone })
  }

  @Test
  fun validatesTheWholeRecordBeforeDeliveryOrCreditReservation() {
    val deliveries = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), {}, {}, {})
    val peer = cipher()
    val stream = mux.open(deliveries::add, {}, {})
    val record = peer.seal(
      TunnelMux.frame(2, stream.id, byteArrayOf(1, 2)) +
        TunnelMux.frame(4, stream.id, byteArrayOf(3))
    )
    assertFails { mux.receive(record) }
    assertTrue(deliveries.isEmpty())
    assertEquals(0, mux.outstandingReceiveBytes)
  }

  @Test
  fun recognizesFragmentedUpgradeAfterAnInterimResponse() {
    val upgrade = CompletableFuture<Boolean>()
    val watcher = HttpUpgradeWatcher(upgrade)
    val response = (
      "HTTP/1.1 100 Continue\r\n\r\n" +
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n\r\n"
      ).toByteArray()
    watcher.observe(response.copyOfRange(0, response.size - 2))
    assertFalse(upgrade.isDone)
    watcher.observe(response.copyOfRange(response.size - 2, response.size))
    assertTrue(upgrade.join())
  }

  @Test
  fun keepsTheFirstFinalResponseUpgradeDecision() {
    val upgrade = CompletableFuture<Boolean>()
    val watcher = HttpUpgradeWatcher(upgrade)
    watcher.observe("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".toByteArray())
    assertFalse(upgrade.join())
    watcher.observe("HTTP/1.1 101 Switching Protocols\r\n\r\n".toByteArray())
    assertFalse(upgrade.join())
  }

  @Test
  fun rejectsOversizedResponseHeadersBeforeAcceptingAnUpgrade() {
    val upgrade = CompletableFuture<Boolean>()
    val watcher = HttpUpgradeWatcher(upgrade)
    assertFails {
      watcher.observe(("HTTP/1.1 101 Switching Protocols\r\nX: " + "a".repeat(65536)).toByteArray())
    }
    assertFalse(upgrade.isDone)
  }

  @Test
  fun returnsCreditOnlyAfterConsumptionAndChecksCumulativeStreamBudget() {
    val emitted = ArrayList<ByteArray>()
    val deliveries = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = cipher()
    val stream = mux.open(deliveries::add, {}, {})
    mux.pump()
    emitted.clear()
    repeat(32) { mux.receive(peer.seal(TunnelMux.frame(2, stream.id, ByteArray(65527)))) }
    mux.pump()
    assertTrue(emitted.isEmpty(), "No WINDOW may be sent before consumption")
    assertEquals(32 * 65527, mux.outstandingReceiveBytes)
    assertFails { mux.receive(peer.seal(TunnelMux.frame(2, stream.id, ByteArray(1024)))) }
    deliveries.forEach { mux.consumed(stream, it.size) }
    mux.pump()
    assertTrue(emitted.isNotEmpty())
    assertTrue(mux.outstandingReceiveBytes < TunnelMux.SESSION_WINDOW / 4)
    mux.close(IllegalStateException("test"))
  }

  @Test
  fun checksCumulativeSessionBudgetAcrossStreams() {
    val mux = TunnelMux(cipher(), {}, {}, {})
    val peer = cipher()
    val streams = List(5) { mux.open({}, {}, {}) }
    repeat(128) { i ->
      mux.receive(peer.seal(TunnelMux.frame(2, streams[i % 4].id, ByteArray(65527))))
    }
    assertEquals(
      "Session receive window exceeded",
      assertFails { mux.receive(peer.seal(TunnelMux.frame(2, streams[4].id, ByteArray(2048)))) }
        .message,
    )
  }

  @Test
  fun rejectsASecondRequestsForeignHostAndAllowsChunkedBodies() {
    val header =
      "POST /api/upload HTTP/1.1\r\nHost: 127.0.0.1:1234\r\nTransfer-Encoding: chunked\r\n\r\n"
    val valid = header + "3\r\nabc\r\n0\r\n\r\nGET /next HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n\r\n"
    val bytes = ArrayList<ByteArray>()
    LoopbackHttp.pipe(
      BufferedInputStream(ByteArrayInputStream(valid.toByteArray())),
      "127.0.0.1:1234",
      CompletableFuture(),
      bytes::add,
    )
    assertEquals(valid, bytes.fold(ByteArray(0)) { a, b -> a + b }.toString(Charsets.UTF_8))
    val wrong = valid + "GET /secret HTTP/1.1\r\nHost: evil.example\r\n\r\n"
    val sent = ArrayList<ByteArray>()
    assertFails {
      LoopbackHttp.pipe(
        BufferedInputStream(ByteArrayInputStream(wrong.toByteArray())),
        "127.0.0.1:1234",
        CompletableFuture(),
        sent::add,
      )
    }
    assertEquals(valid, sent.fold(ByteArray(0)) { a, b -> a + b }.toString(Charsets.UTF_8))
  }

  @Test
  fun sendFailureReleasesBlockedLocalWriter() {
    val mux = TunnelMux(cipher(), { throw IllegalStateException("transport closed") }, {}, {})
    val stream = mux.open({}, {}, {})
    val sent = CompletableFuture<Unit>()
    mux.write(stream, ByteArray(100), sent)
    assertFails { mux.pump() }
    assertTrue(sent.isCompletedExceptionally)
  }

  @Test
  fun answersPingWithPongAndRejectsMalformedKeepalives() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = cipher()
    mux.receive(peer.seal(TunnelMux.frame(6, 0) + TunnelMux.frame(7, 0)))
    mux.pump()
    assertEquals(listOf(7 to 0), frameHeaders(peer.open(emitted.single())))
    for (invalid in listOf(TunnelMux.frame(6, 1), TunnelMux.frame(7, 0, byteArrayOf(1)))) {
      assertFails { TunnelMux(cipher(), {}, {}, {}).receive(cipher().seal(invalid)) }
    }
  }

  @Test
  fun pingsOnIdleTicksAndTimesOutAfterThreeMissedTicks() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = cipher()
    fun tick(): List<Pair<Int, Int>> {
      mux.tick()
      mux.pump()
      return emitted.flatMap { frameHeaders(peer.open(it)) }.also { emitted.clear() }
    }
    assertEquals(listOf(6 to 0), tick())
    mux.receive(peer.seal(TunnelMux.frame(7, 0)))
    assertTrue(tick().isEmpty())
    assertEquals(listOf(6 to 0), tick())
    assertEquals(listOf(6 to 0), tick())
    assertFailsWith<TimeoutException> { mux.tick() }
  }

  @Test
  fun coalescesQueuedWritesIntoOneRecord() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = cipher()
    val stream = mux.open({}, {}, {})
    val writes = List(8) { index ->
      CompletableFuture<Unit>().also { mux.write(stream, ByteArray(1000) { index.toByte() }, it) }
    }
    mux.pump()
    val plain = peer.open(emitted.single())
    assertEquals(listOf(1 to stream.id, 2 to stream.id), frameHeaders(plain))
    assertContentEquals(ByteArray(8000) { (it / 1000).toByte() }, plain.copyOfRange(18, plain.size))
    assertTrue(writes.all { it.isDone })
  }

  private class Peer(private val mux: TunnelMux, private val emitted: MutableList<ByteArray>) {
    private val cipher = RelayCipher(ByteArray(32) { 1 }, ByteArray(32) { 1 })
    private val credits = HashMap<Int, Int>()
    val sessionWindows = ArrayList<Int>()

    private fun credit(id: Int) =
      credits[id] ?: if (id == 0) TunnelMux.SESSION_WINDOW else TunnelMux.STREAM_WINDOW

    fun send(vararg data: Pair<Int, Int>) {
      val total = data.sumOf { it.second }
      check(credit(0) >= TunnelMux.MIN_COST && total <= credit(0)) { "Sender stalled" }
      credits[0] = credit(0) - maxOf(total, TunnelMux.MIN_COST)
      for ((id, size) in data) {
        check(size <= credit(id)) { "Stream $id stalled" }
        credits[id] = credit(id) - size
      }
      val plain = data.fold(ByteArray(0)) { plain, (id, size) ->
        plain + TunnelMux.frame(2, id, ByteArray(size))
      }
      mux.receive(cipher.seal(plain))
    }

    fun drain() {
      mux.pump()
      emitted.forEach { grant(ByteBuffer.wrap(cipher.open(it))) }
      emitted.clear()
    }

    private fun grant(plain: ByteBuffer) {
      while (plain.hasRemaining()) {
        val type = plain.get().toInt()
        val id = plain.int
        val payload = ByteArray(plain.int).also { plain.get(it) }
        if (type != 3) continue
        val bytes = ByteBuffer.wrap(payload).int
        credits[id] = credit(id) + bytes
        if (id == 0) sessionWindows.add(bytes)
      }
    }
  }

  @Test
  fun returnsConsumedCreditWhileStalledStreamsHoldMostOfTheSession() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = Peer(mux, emitted)
    val full = TunnelMux.MAX_PLAIN - 9
    var received = 0
    val active = mux.open({ received += it.size }, {}, {})
    val stalled = List(3) { mux.open({}, {}, {}) }
    fun exchange() {
      peer.send(active.id to full)
      mux.consumed(active, full)
      peer.drain()
    }
    repeat(32) { exchange() }
    assertTrue(peer.sessionWindows.isEmpty())
    for (stream in stalled) repeat(32) { peer.send(stream.id to full) }
    peer.drain()
    repeat(128) { exchange() }
    assertEquals(160 * full, received)
    assertEquals(3 * 32 * full, mux.outstandingReceiveBytes)
  }

  @Test
  fun mixedRecordsReturnTheConsumedStreamsCreditWhileAnotherStalls() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = Peer(mux, emitted)
    val active = mux.open({}, {}, {})
    val stalled = mux.open({}, {}, {})
    repeat(44) {
      peer.send(stalled.id to 16_000, active.id to 48_000)
      mux.consumed(active, 48_000)
      peer.drain()
    }
    assertEquals(listOf(44 * 48_000), peer.sessionWindows)
    assertEquals(44 * 16_000, mux.outstandingReceiveBytes)
  }

  @Test
  fun smallMixedRecordsDoNotPinOverheadBehindAStalledStream() {
    val emitted = ArrayList<ByteArray>()
    val mux = TunnelMux(cipher(), emitted::add, {}, {})
    val peer = Peer(mux, emitted)
    var received = 0
    val active = mux.open({ received += it.size }, {}, {})
    val stalled = mux.open({}, {}, {})
    repeat(256) {
      peer.send(stalled.id to 100, active.id to 1_000)
      mux.consumed(active, 1_000)
      peer.drain()
    }
    assertEquals(256 * 1_000, received)
    assertEquals(256 * 100, mux.outstandingReceiveBytes)
  }
}
