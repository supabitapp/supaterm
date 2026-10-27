package expo.modules.supatermrelaytunnel

import android.net.ConnectivityManager
import android.net.Network
import android.util.Log
import android.os.SystemClock
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.supatermrelaytunnel.core.NativeTunnel
import expo.modules.supatermrelaytunnel.core.hex
import expo.modules.supatermrelaytunnel.core.parseRelayIdentity
import expo.modules.supatermrelaytunnel.core.sha256

class RelayTunnelOptions : Record {
  @Field var relayUrl: String = ""

  @Field var hostAddress: String = ""

  @Field var directUrls: List<String> = emptyList()

  @Field var port: Int? = null
}

class SupatermRelayTunnelModule : Module() {
  private val tunnels = LinkedHashMap<String, NativeTunnel>()
  private var backgroundDeadline: Long? = null
  private var connectivity: ConnectivityManager? = null

  // A LAN or tailnet address that answered on the old network may now be unreachable or belong to
  // another machine, so direct sessions are dropped and the next request races again.
  private val networkCallback =
    object : ConnectivityManager.NetworkCallback() {
      private var current: Network? = null

      override fun onAvailable(network: Network) {
        val previous = current
        current = network
        if (previous != null && previous != network) networkChanged()
      }

      override fun onLost(network: Network) {
        if (network != current) return
        current = null
        networkChanged()
      }
    }

  private fun networkChanged() = synchronized(tunnels) {
    tunnels.values.forEach { it.networkChanged() }
  }

  private fun stopAll() =
    synchronized(tunnels) {
      tunnels.values.forEach { it.close() }
      tunnels.clear()
    }

  override fun definition() = ModuleDefinition {
    Name("SupatermRelayTunnel")
    Events("onStatus")
    OnCreate {
      connectivity =
        appContext.reactContext?.getSystemService(ConnectivityManager::class.java)?.also {
          it.registerDefaultNetworkCallback(networkCallback)
        }
    }
    AsyncFunction("start") { options: RelayTunnelOptions ->
      synchronized(tunnels) {
        val graceRemaining = backgroundDeadline?.minus(SystemClock.elapsedRealtime())
        check(graceRemaining == null || graceRemaining > 0) {
          "Relay tunnel is suspended while the app is in the background"
        }
        val digest = sha256(parseRelayIdentity(options.hostAddress))
        val key = digest.hex()
        val existing = tunnels[key]
        if (existing != null) {
          existing.setDirectUrls(options.directUrls)
          mapOf("origin" to existing.origin)
        } else {
          val port =
            options.port
              ?: (
                40000 +
                  (((digest[0].toInt() and 255) shl 8 or (digest[1].toInt() and 255)) % 20000)
                )
          fun create(port: Int) =
            NativeTunnel(
              options.relayUrl,
              options.hostAddress,
              port,
              { event -> sendEvent("onStatus", event) },
              { line -> Log.i("SupatermRelayTunnel", line) },
              directUrls = options.directUrls,
            )
          val tunnel =
            try {
              create(port)
            } catch (error: java.net.BindException) {
              if (port == 0) throw error else create(0)
            }
          tunnels[key] = tunnel
          graceRemaining?.let { tunnel.background(it) }
          mapOf("origin" to tunnel.origin)
        }
      }
    }
    AsyncFunction("stop") { hostAddress: String? ->
      if (hostAddress == null) {
        stopAll()
      } else {
        synchronized(tunnels) {
          tunnels.remove(sha256(parseRelayIdentity(hostAddress)).hex())?.close()
        }
      }
    }
    OnActivityEntersBackground {
      synchronized(tunnels) {
        backgroundDeadline = SystemClock.elapsedRealtime() + NativeTunnel.BACKGROUND_GRACE_MILLIS
        tunnels.values.forEach { it.background() }
      }
    }
    OnActivityEntersForeground {
      synchronized(tunnels) {
        backgroundDeadline = null
        tunnels.values.forEach { it.resume() }
      }
    }
    OnDestroy {
      connectivity?.unregisterNetworkCallback(networkCallback)
      connectivity = null
      stopAll()
    }
  }
}
