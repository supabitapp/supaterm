package expo.modules.supatermrelaytunnel.core

import com.google.crypto.tink.subtle.Ed25519Verify
import com.google.crypto.tink.subtle.X25519
import java.net.URI
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.Security
import java.security.Signature
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import okio.ByteString.Companion.toByteString
import okio.ByteString.Companion.decodeBase64
import com.google.crypto.tink.aead.internal.InsecureNonceChaCha20Poly1305
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

internal fun ByteArray.hex() = joinToString("") { "%02x".format(it) }

internal fun unhex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

internal fun sha256(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes)

internal fun b64(bytes: ByteArray) = bytes.toByteString().base64Url().trimEnd('=')

internal fun unb64(value: String): ByteArray {
  require(Regex("[A-Za-z0-9_-]*").matches(value)) { "Invalid relay encoding" }
  return requireNotNull(value.decodeBase64()) { "Invalid relay encoding" }.toByteArray()
}

private fun softwareKeyFactory(algorithm: String): KeyFactory? =
  Security.getProviders("KeyFactory.$algorithm")
    ?.firstOrNull { it.name != "AndroidKeyStore" }
    ?.let { KeyFactory.getInstance(algorithm, it) }

internal class CurveCrypto(val forceFallback: Boolean = false) {
  private val xFactory = if (forceFallback) null else softwareKeyFactory("X25519")
  private val edFactory = if (forceFallback) null else softwareKeyFactory("Ed25519")
  val provider: String
    get() =
      "x25519=${xFactory?.provider?.name ?: "Tink"} ed25519=${edFactory?.provider?.name ?: "Tink"}"

  fun shared(secret: ByteArray, peer: ByteArray): ByteArray {
    require(secret.size == 32 && peer.size == 32)
    val result =
      if (xFactory == null) {
        X25519.computeSharedSecret(secret, peer)
      } else {
        val privateKey =
          xFactory.generatePrivate(
            PKCS8EncodedKeySpec(unhex("302e020100300506032b656e04220420") + secret)
          )
        val publicKey =
          xFactory.generatePublic(X509EncodedKeySpec(unhex("302a300506032b656e032100") + peer))
        KeyAgreement.getInstance("X25519", xFactory.provider).run {
          init(privateKey)
          doPhase(publicKey, true)
          generateSecret()
        }
      }
    require(result.any { it != 0.toByte() }) { "Invalid X25519 shared secret" }
    return result
  }

  fun publicKey(secret: ByteArray) = shared(secret, ByteArray(32).also { it[0] = 9 })

  fun verify(identity: ByteArray, message: ByteArray, signature: ByteArray) {
    require(identity.size == 32 && signature.size == 64)
    if (edFactory == null) {
      Ed25519Verify(identity).verify(signature, message)
    } else {
      val key =
        edFactory.generatePublic(X509EncodedKeySpec(unhex("302a300506032b6570032100") + identity))
      require(
        Signature.getInstance("Ed25519", edFactory.provider).run {
          initVerify(key)
          update(message)
          verify(signature)
        }
      ) {
        "Relay host identity mismatch"
      }
    }
  }
}

internal const val RELAY_ADDRESS_SUFFIX = ".relay.supaterm.alt"
private const val LEGACY_RELAY_ADDRESS_SUFFIX = ".relay.supaterm.invalid"

internal fun parseRelayIdentity(address: String): ByteArray {
  val uri = URI(address)
  require(uri.scheme in listOf("https", "wss") && uri.port == -1 && uri.userInfo == null) {
    "Invalid relay address"
  }
  val host = uri.host?.lowercase() ?: error("Invalid relay address")
  val key =
    listOf(RELAY_ADDRESS_SUFFIX, LEGACY_RELAY_ADDRESS_SUFFIX)
      .firstOrNull { host.endsWith(it) }
      ?.let { host.removeSuffix(it) }
  require(key != null && Regex("[0-9a-f]{32}\\.[0-9a-f]{32}").matches(key)) {
    "Invalid relay identity"
  }
  return unhex(key.replace(".", ""))
}

internal class ClientHandshake(
  private val identity: ByteArray,
  private val secret: ByteArray = ByteArray(32).also(SecureRandom()::nextBytes),
  private val curves: CurveCrypto = CurveCrypto()
) {
  private val publicKey = curves.publicKey(secret)
  private var finished = false
  val hello: String =
    JSONObject().put("type", "hello").put("version", 2).put("key", b64(publicKey)).toString()

  fun finish(raw: String): RelayCipher {
    check(!finished) { "Handshake already completed" }
    finished = true
    try {
      require(raw.length <= 4096)
      val welcome = JSONObject(raw)
      require(welcome.getString("type") == "welcome" && welcome.getInt("version") == 2) {
        "Relay protocol mismatch"
      }
      val host = unb64(welcome.getString("key"))
      require(host.size == 32)
      val transcript = "supaterm-tunnel-v2\n".toByteArray() + identity + publicKey + host
      curves.verify(identity, transcript, unb64(welcome.getString("signature")))
      val shared = curves.shared(secret, host)
      return try {
        RelayCipher.derive(shared, transcript, curves.forceFallback)
      } finally {
        shared.fill(0)
      }
    } finally {
      secret.fill(0)
    }
  }

  fun destroy() {
    finished = true
    secret.fill(0)
  }
}

internal class RelayCipher(
  private val sendKey: ByteArray,
  private val receiveKey: ByteArray,
  forceFallback: Boolean = false
) {
  private var sent = 0L
  private var received = 0L
  private var sendExhausted = false
  private var receiveExhausted = false
  private var destroyed = false
  private val encryptor = if (forceFallback) {
    null
  } else {
    runCatching {
      Cipher.getInstance("ChaCha20-Poly1305")
    }.getOrNull()
  }
  private val decryptor = if (forceFallback) {
    null
  } else {
    runCatching {
      Cipher.getInstance("ChaCha20-Poly1305")
    }.getOrNull()
  }
  private val sendFallback = if (encryptor == null) InsecureNonceChaCha20Poly1305(sendKey) else null
  private val receiveFallback = if (decryptor ==
    null
  ) {
    InsecureNonceChaCha20Poly1305(receiveKey)
  } else {
    null
  }

  fun seal(plain: ByteArray): ByteArray {
    check(!destroyed && !sendExhausted)
    val nonce = ByteBuffer.allocate(12).putInt(0).putLong(sent).array()
    val encrypted = if (encryptor != null) {
      encryptor.init(
        Cipher.ENCRYPT_MODE,
        SecretKeySpec(sendKey, "ChaCha20"),
        IvParameterSpec(nonce)
      )
      encryptor.doFinal(plain)
    } else {
      sendFallback!!.encrypt(nonce, plain, ByteArray(0))
    }
    val result = nonce.copyOfRange(4, 12) + encrypted
    if (sent == -1L) sendExhausted = true else sent++
    return result
  }

  fun open(frame: ByteArray, maxPlainBytes: Int = 65536): ByteArray {
    require(!destroyed && !receiveExhausted && frame.size in 24..maxPlainBytes + 24) {
      "Invalid relay record"
    }
    require(ByteBuffer.wrap(frame).long == received) { "Relay record out of order" }
    val nonce = ByteArray(12).also { frame.copyInto(it, 4, 0, 8) }
    val result = if (decryptor != null) {
      decryptor.init(
        Cipher.DECRYPT_MODE,
        SecretKeySpec(receiveKey, "ChaCha20"),
        IvParameterSpec(nonce)
      )
      decryptor.doFinal(frame, 8, frame.size - 8)
    } else {
      receiveFallback!!.decrypt(nonce, frame.copyOfRange(8, frame.size), ByteArray(0))
    }
    if (received == -1L) receiveExhausted = true else received++
    return result
  }

  fun destroy() {
    destroyed = true
    sendKey.fill(0)
    receiveKey.fill(0)
  }

  companion object {
    fun derive(
      shared: ByteArray,
      transcript: ByteArray,
      forceFallback: Boolean = false
    ): RelayCipher {
      fun hmac(key: ByteArray, bytes: ByteArray) =
        Mac.getInstance("HmacSHA256").run {
          init(SecretKeySpec(key, "HmacSHA256"))
          doFinal(bytes)
        }
      val prk = hmac(sha256(transcript), shared)
      val info = "supaterm-tunnel-traffic-v1".toByteArray()
      val first = hmac(prk, info + byteArrayOf(1))
      val second = hmac(prk, first + info + byteArrayOf(2))
      prk.fill(0)
      return RelayCipher(first, second, forceFallback)
    }
  }
}
