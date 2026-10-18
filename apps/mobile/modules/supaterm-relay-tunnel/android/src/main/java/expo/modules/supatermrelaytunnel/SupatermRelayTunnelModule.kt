package expo.modules.supatermrelaytunnel

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

  @Field var port: Int? = null
}

class SupatermRelayTunnelModule : Module() {
  private val tunnels = LinkedHashMap<String, NativeTunnel>()
  private var backgroundDeadline: Long? = null

  private fun stopAll() =
    synchronized(tunnels) {
      tunnels.values.forEach { it.close() }
      tunnels.clear()
    }

  override fun definition() = ModuleDefinition {
    Name("SupatermRelayTunnel")
    Events("onStatus")
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
    OnDestroy { stopAll() }
  }
}
