package expo.modules.supatermrelaytunnel.core

import java.net.URI
import java.net.URISyntaxException

internal const val MAX_DIRECT_CANDIDATES = 8

internal enum class TunnelRoute(val code: String) {
  RELAY("relay"),
  DIRECT("direct")
}

internal fun isTunnelBaseUrl(value: String): Boolean {
  val uri =
    try {
      URI(value)
    } catch (_: URISyntaxException) {
      return false
    }
  return uri.scheme in listOf("ws", "wss") &&
    !uri.host.isNullOrEmpty() &&
    uri.rawUserInfo == null &&
    uri.rawQuery == null &&
    uri.rawFragment == null
}

internal fun directTunnelUrls(values: List<String>) =
  values.filter(::isTunnelBaseUrl).distinct().take(MAX_DIRECT_CANDIDATES)

internal class TunnelRace<F : Any>(routes: Map<Int, TunnelRoute>) {
  private val open = routes.toMutableMap()
  private var relayFailure: F? = null
  private var firstFailure: F? = null
  var winner: Int? = null
    private set

  // null means the candidate already failed or another one won first.
  fun welcome(id: Int): List<Int>? {
    if (winner != null || open.remove(id) == null) return null
    winner = id
    return open.keys.sorted().also { open.clear() }
  }

  // The relay's reason is what users act on, so it outranks direct failures once all have failed.
  fun fail(id: Int, failure: F): F? {
    val route = if (winner == null) open.remove(id) else null
    if (route == null) return null
    if (route == TunnelRoute.RELAY) relayFailure = failure
    if (firstFailure == null) firstFailure = failure
    return if (open.isEmpty()) relayFailure ?: firstFailure else null
  }
}
