package expo.modules.supatermrelaytunnel.core

import java.io.BufferedInputStream
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString

private class RelayAttemptException(val failure: RelayFailure, message: String, cause: Throwable?) :
  IllegalStateException("$message: ${failure.code}", cause)

@Suppress("LongParameterList")
class NativeTunnel(
  private val relayUrl: String,
  hostAddress: String,
  port: Int = 0,
  private val onStatus: (Map<String, Any>) -> Unit = {},
  private val log: (String) -> Unit = {},
  private val timing: Timing = Timing(),
  directUrls: List<String> = emptyList()
) : AutoCloseable {
  companion object {
    const val BACKGROUND_GRACE_MILLIS = 5 * 60_000L
    private const val SWITCHING_PROTOCOLS = 101
  }

  data class Timing(
    val keepaliveMillis: Long = 15_000,
    val handshakeTimeoutMillis: Long = 15_000,
    val directTimeoutMillis: Long = 5_000,
    val failureCooldownMillis: Long = 2_000
  )

  private class Candidate(val id: Int, val route: TunnelRoute, identity: ByteArray) {
    val handshake = ClientHandshake(identity)
    var socket: WebSocket? = null
    var deadline: ScheduledFuture<*>? = null

    fun close() {
      deadline?.cancel(false)
      socket?.cancel()
      handshake.destroy()
    }
  }

  private val identity = parseRelayIdentity(hostAddress)
  private val hostAddress =
    identity.hex().let { "https://${it.take(32)}.${it.drop(32)}$RELAY_ADDRESS_SUFFIX/" }
  private val actor = Executors.newSingleThreadScheduledExecutor {
    Thread(it, "relay-session").apply { isDaemon = true }
  }
  private val io = Executors.newCachedThreadPool {
    Thread(it, "relay-loopback").apply { isDaemon = true }
  }
  private val http =
    OkHttpClient.Builder()
      .pingInterval(20, TimeUnit.SECONDS)
      .connectTimeout(15, TimeUnit.SECONDS)
      .readTimeout(0, TimeUnit.SECONDS)
      .build()
  private val listener = ServerSocket()
  private val stopped = AtomicBoolean(false)
  private val slots = Semaphore(256)
  private val sockets = java.util.concurrent.ConcurrentHashMap.newKeySet<Socket>()
  private var directCandidates = directTunnelUrls(directUrls)
  private val candidates = HashMap<Int, Candidate>()
  private var race: TunnelRace<RelayAttemptException>? = null
  private var route: TunnelRoute? = null
  private var attempt: CompletableFuture<TunnelMux>? = null
  private var mux: TunnelMux? = null
  private var webSocket: WebSocket? = null
  private var keepalive: ScheduledFuture<*>? = null
  private var backgroundClose: ScheduledFuture<*>? = null
  private var probeDeadline: ScheduledFuture<*>? = null
  private var cooldownFailure: RelayAttemptException? = null
  private var cooldownUntil = 0L
  private var pumpScheduled = false
  private var state = "down"
  private var suspended = false
  private var sentBytes = 0L
  private var receivedBytes = 0L
  private var sessions = 0
  private var lastStatus: Map<String, Any>? = null
  val origin: String

  init {
    require(port in 0..65535)
    require(isTunnelBaseUrl(relayUrl))
    listener.reuseAddress = true
    try {
      listener.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), port))
    } catch (error: IOException) {
      listener.close()
      actor.shutdown()
      io.shutdown()
      throw error
    }
    origin = "http://127.0.0.1:${listener.localPort}"
    log("[relay-android] listener origin=$origin ${CurveCrypto().provider}")
    io.execute {
      while (!stopped.get()) {
        try {
          val socket = listener.accept()
          if (!slots.tryAcquire()) {
            socket.close()
            continue
          }
          socket.tcpNoDelay = true
          socket.soTimeout = 0
          sockets.add(socket)
          io.execute { serve(socket) }
        } catch (error: IOException) {
          if (!stopped.get()) log("[relay-android] accept failed: ${error.javaClass.simpleName}")
        } catch (error: RejectedExecutionException) {
          if (!stopped.get()) log("[relay-android] accept failed: ${error.javaClass.simpleName}")
        }
      }
    }
  }

  private fun emit(error: String? = null) {
    val value =
      linkedMapOf<String, Any>(
        "state" to state,
        "origin" to origin,
        "hostAddress" to hostAddress,
        "bytesSent" to sentBytes,
        "bytesReceived" to receivedBytes,
        "activeStreams" to (mux?.streamCount ?: 0),
        "sessionCount" to sessions,
      )
    route?.let { value["via"] = it.code }
    if (error != null) value["reason"] = error
    if (value == lastStatus) return
    lastStatus = value
    log(
      "[relay-android] $state origin=$origin sessions=$sessions via=${route?.code} " +
        "streams=${mux?.streamCount ?: 0} up=$sentBytes down=$receivedBytes"
    )
    onStatus(value)
  }

  private fun connect(): CompletableFuture<TunnelMux> {
    attempt?.let { return it }
    val future = CompletableFuture<TunnelMux>()
    val recentFailure = cooldownFailure?.takeIf { System.nanoTime() < cooldownUntil }
    if (stopped.get() || suspended) {
      future.completeExceptionally(IllegalStateException("Tunnel unavailable"))
    } else if (recentFailure != null) {
      future.completeExceptionally(recentFailure)
    } else {
      attempt = future
      state = "connecting"
      emit()
      log("[relay-android] session connecting")
      dial(future)
    }
    return future
  }

  @Suppress("TooGenericExceptionCaught")
  private fun failOnError(future: CompletableFuture<TunnelMux>, block: () -> Unit) {
    try {
      block()
    } catch (error: Exception) {
      fail(future, error)
    }
  }

  private fun dial(future: CompletableFuture<TunnelMux>) = failOnError(future) {
    val bases =
      listOf(relayUrl to TunnelRoute.RELAY) + directCandidates.map { it to TunnelRoute.DIRECT }
    bases.forEachIndexed { id, (_, route) -> candidates[id] = Candidate(id, route, identity) }
    race = TunnelRace(candidates.mapValues { it.value.route })
    bases.forEachIndexed { id, (base, _) -> start(future, candidates.getValue(id), base) }
  }

  private fun start(future: CompletableFuture<TunnelMux>, candidate: Candidate, base: String) {
    val timeout =
      if (candidate.route == TunnelRoute.RELAY) {
        timing.handshakeTimeoutMillis
      } else {
        minOf(timing.directTimeoutMillis, timing.handshakeTimeoutMillis)
      }
    candidate.deadline = actor.schedule(
      {
        lose(
          future,
          candidate,
          RelayAttemptException(RelayFailure.TIMEOUT, "Relay handshake timed out", null),
        )
      },
      timeout,
      TimeUnit.MILLISECONDS,
    )
    candidate.socket = http.newWebSocket(
      Request.Builder()
        .url(base.trimEnd('/') + "/v1/connect?endpointId=" + sha256(identity).hex())
        .build(),
      object : WebSocketListener() {
        override fun onOpen(socket: WebSocket, response: Response) {
          post {
            if (candidates[candidate.id] === candidate && !socket.send(candidate.handshake.hello)) {
              lose(future, candidate, IllegalStateException("Relay send failed"))
            }
          }
        }

        override fun onMessage(socket: WebSocket, text: String) {
          post {
            when {
              candidates[candidate.id] === candidate -> win(future, candidate, text)
              webSocket === socket -> fail(
                future,
                IllegalStateException("Unencrypted relay message")
              )
              else -> socket.cancel()
            }
          }
        }

        override fun onMessage(socket: WebSocket, bytes: ByteString) {
          post {
            when {
              webSocket === socket -> failOnError(future) { mux?.receive(bytes.toByteArray()) }
              candidates[candidate.id] === candidate ->
                lose(future, candidate, IllegalStateException("Binary handshake"))
            }
          }
        }

        override fun onClosing(socket: WebSocket, code: Int, reason: String) {
          socket.close(1000, null)
          post {
            end(
              future,
              candidate,
              socket,
              IllegalStateException("Relay disconnected ($code)"),
              SWITCHING_PROTOCOLS,
            )
          }
        }

        override fun onClosed(socket: WebSocket, code: Int, reason: String) {
          post {
            end(
              future,
              candidate,
              socket,
              IllegalStateException("Relay disconnected ($code)"),
              SWITCHING_PROTOCOLS,
            )
          }
        }

        override fun onFailure(socket: WebSocket, error: Throwable, response: Response?) {
          post { end(future, candidate, socket, error, response?.code) }
        }
      },
    )
  }

  @Suppress("TooGenericExceptionCaught")
  private fun win(future: CompletableFuture<TunnelMux>, candidate: Candidate, welcome: String) {
    val cipher =
      try {
        candidate.handshake.finish(welcome)
      } catch (error: Exception) {
        lose(future, candidate, error)
        return
      }
    val losers = race?.welcome(candidate.id)
    if (attempt !== future || losers == null) {
      cipher.destroy()
      candidate.close()
      return
    }
    race = null
    candidate.deadline?.cancel(false)
    losers.forEach { candidates[it]?.close() }
    candidates.clear()
    val socket = checkNotNull(candidate.socket)
    webSocket = socket
    route = candidate.route
    failOnError(future) {
      val session = TunnelMux(
        cipher,
        { record -> check(socket.send(record.toByteString())) { "Relay queue full" } },
        ::schedulePump,
        { sentBytes += it },
        {
          probeDeadline?.cancel(false)
          probeDeadline = null
        },
      )
      mux = session
      cooldownFailure = null
      keepalive = actor.scheduleWithFixedDelay(
        { failOnError(future) { session.tick() } },
        timing.keepaliveMillis,
        timing.keepaliveMillis,
        TimeUnit.MILLISECONDS,
      )
      sessions++
      state = "up"
      emit()
      log("[relay-android] session $sessions up via=${candidate.route.code}")
      future.complete(session)
    }
  }

  private fun lose(
    future: CompletableFuture<TunnelMux>,
    candidate: Candidate,
    cause: Throwable,
    relayStatus: Int? = null
  ) {
    if (attempt !== future || candidates[candidate.id] !== candidate) return
    candidates.remove(candidate.id)
    candidate.close()
    val error =
      cause as? RelayAttemptException
        ?: RelayAttemptException(
          RelayFailure.from(relayStatus),
          cause.message ?: "Relay disconnected",
          cause,
        )
    log("[relay-android] ${candidate.route.code} candidate failed: ${error.message}")
    race?.fail(candidate.id, error)?.let { fail(future, it) }
  }

  private fun end(
    future: CompletableFuture<TunnelMux>,
    candidate: Candidate,
    socket: WebSocket,
    cause: Throwable,
    relayStatus: Int?
  ) {
    if (candidates[candidate.id] === candidate) {
      lose(future, candidate, cause, relayStatus)
    } else if (webSocket === socket) {
      fail(future, cause, relayStatus)
    }
  }

  private fun post(block: () -> Unit): Boolean {
    if (!actor.isShutdown) {
      try {
        actor.execute(block)
        return true
      } catch (_: java.util.concurrent.RejectedExecutionException) {}
    }
    return false
  }

  private fun fail(
    future: CompletableFuture<TunnelMux>,
    cause: Throwable,
    relayStatus: Int? = null
  ) {
    if (attempt !== future) return
    val error =
      when {
        cause is RelayAttemptException -> cause
        mux != null || suspended || stopped.get() -> cause
        else ->
          RelayAttemptException(
            RelayFailure.from(relayStatus),
            cause.message ?: "Relay disconnected",
            cause,
          )
      }
    if (error is RelayAttemptException) {
      cooldownFailure = error
      cooldownUntil =
        System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timing.failureCooldownMillis)
    }
    attempt = null
    candidates.values.forEach { it.close() }
    candidates.clear()
    race = null
    route = null
    keepalive?.cancel(false)
    keepalive = null
    probeDeadline?.cancel(false)
    probeDeadline = null
    mux?.close(error)
    mux = null
    webSocket?.cancel()
    webSocket = null
    future.completeExceptionally(error)
    state = "down"
    emit(error.message ?: "Relay disconnected")
    log(
      "[relay-android] session down: ${(error.cause ?: error).javaClass.simpleName}: ${error.message}"
    )
  }

  private fun schedulePump() {
    if (pumpScheduled || stopped.get()) return
    pumpScheduled = true
    actor.execute {
      pumpScheduled = false
      attempt?.let { future -> failOnError(future) { mux?.pump() } }
    }
  }

  @Suppress("TooGenericExceptionCaught")
  private fun <T> onActor(block: () -> T): CompletableFuture<T> {
    val future = CompletableFuture<T>()
    if (!post {
        try {
          future.complete(block())
        } catch (error: Exception) {
          future.completeExceptionally(error)
        }
      }
    ) {
      future.completeExceptionally(IllegalStateException("Tunnel unavailable"))
    }
    return future
  }

  private fun write(session: TunnelMux, stream: TunnelMux.Stream, bytes: ByteArray) {
    onActor {
      CompletableFuture<Unit>().also { session.write(stream, bytes, it) }
    }.thenCompose { it }.get()
  }

  private class Incoming(val bytes: ByteArray? = null)

  @Suppress("TooGenericExceptionCaught")
  private fun serve(socket: Socket) {
    var stream: TunnelMux.Stream? = null
    var session: TunnelMux? = null
    val queue = LinkedBlockingQueue<Incoming>()
    val upgrade = CompletableFuture<Boolean>()
    val closed = AtomicBoolean(false)
    fun finishSocket() {
      if (closed.compareAndSet(false, true)) {
        queue.add(Incoming())
        upgrade.complete(false)
        try {
          socket.close()
        } catch (_: IOException) {
        } finally {
          sockets.remove(socket)
          slots.release()
        }
      }
    }
    try {
      session = onActor { connect() }.thenCompose { it }.get(20, TimeUnit.SECONDS)
      val selected = session
      stream = onActor {
        selected.open(
          { bytes ->
            receivedBytes += bytes.size
            queue.add(Incoming(bytes))
          },
          { queue.add(Incoming()) },
          { finishSocket() },
        )
      }.get(20, TimeUnit.SECONDS)
      val active = stream
      io.execute {
        val response = HttpUpgradeWatcher(upgrade)
        try {
          val output = socket.getOutputStream()
          while (!closed.get()) {
            val incoming = queue.take().bytes ?: break
            output.write(incoming)
            response.observe(incoming)
            post { selected.consumed(active, incoming.size) }
          }
          if (!socket.isClosed) socket.shutdownOutput()
        } catch (error: Exception) {
          post { selected.reset(active, error) }
          finishSocket()
        }
      }
      LoopbackHttp.pipe(
        BufferedInputStream(socket.getInputStream(), 65536),
        "127.0.0.1:${listener.localPort}",
        upgrade,
        { bytes -> write(selected, active, bytes) },
      )
      post { selected.end(active) }
    } catch (error: Exception) {
      val active = stream
      val selected = session
      if (active != null && selected != null) post { selected.reset(active, error) }
      val rejected = (error as? ExecutionException)?.cause as? RelayAttemptException
      if (selected == null && rejected != null) LoopbackHttp.answer(socket, rejected.failure)
      finishSocket()
    }
  }

  fun setDirectUrls(urls: List<String>) {
    val validated = directTunnelUrls(urls)
    post { directCandidates = validated }
  }

  // Drops only direct sessions: the relay is reachable from any network, a LAN address is not.
  fun networkChanged() = post {
    val current = attempt
    if (current != null && mux != null && route == TunnelRoute.DIRECT) {
      fail(current, IllegalStateException("Network changed"))
    }
  }

  fun suspend() = post {
    backgroundClose?.cancel(false)
    backgroundClose = null
    suspendSession()
  }

  private fun suspendSession() {
    suspended = true
    attempt?.let { fail(it, IllegalStateException("Backgrounded")) }
  }

  fun background(graceMillis: Long = BACKGROUND_GRACE_MILLIS) = post {
    backgroundClose?.cancel(false)
    backgroundClose = actor.schedule({
      backgroundClose = null
      suspendSession()
    }, graceMillis, TimeUnit.MILLISECONDS)
  }

  fun resume(probeTimeoutMillis: Long = 2_000) = post {
    backgroundClose?.cancel(false)
    backgroundClose = null
    suspended = false
    log("[relay-android] foregrounded origin=$origin")
    val current = attempt
    val session = mux
    if (current != null && session == null) {
      fail(current, IllegalStateException("Relay resumed during handshake"))
    }
    cooldownFailure = null
    if (current == null || session == null) return@post
    probeDeadline?.cancel(false)
    probeDeadline = actor.schedule({
      fail(current, IllegalStateException("Relay resume probe timed out"))
    }, probeTimeoutMillis, TimeUnit.MILLISECONDS)
    session.ping()
  }

  override fun close() {
    if (!stopped.compareAndSet(false, true)) return
    listener.close()
    sockets.forEach { it.close() }
    actor.execute {
      backgroundClose?.cancel(false)
      attempt?.let { fail(it, IllegalStateException("Tunnel unavailable")) }
      state = "down"
      emit()
    }
    actor.shutdown()
    io.shutdownNow()
    http.dispatcher.executorService.shutdown()
    http.connectionPool.evictAll()
  }
}
