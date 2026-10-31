package expo.modules.supatermpcmrecorder

import android.Manifest
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.UUID

private const val STATUS_EVENT = "onStatus"
private const val RECORDING_DIRECTORY = "SupatermPcmRecorder"

/** One recording at a time; the JS voice controller already serializes sessions. */
class SupatermPcmRecorderModule : Module() {
  private var recorder: PcmWavRecorder? = null

  override fun definition() = ModuleDefinition {
    Name("SupatermPcmRecorder")
    Events(STATUS_EVENT)

    AsyncFunction("prepare") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      val permission = context.checkSelfPermission(Manifest.permission.RECORD_AUDIO)
      if (permission != PackageManager.PERMISSION_GRANTED) {
        throw Exceptions.MissingPermissions(Manifest.permission.RECORD_AUDIO)
      }
      replace(null)
      val directory = File(context.cacheDir, RECORDING_DIRECTORY).apply { mkdirs() }
      val next = PcmWavRecorder(File(directory, "${UUID.randomUUID()}.wav")) { status ->
        sendEvent(STATUS_EVENT, status)
      }
      next.prepare()
      replace(next)
      mapOf("uri" to next.uri)
    }

    Function("record") { maxDurationMs: Double ->
      val active = current() ?: error("The voice recorder is not prepared.")
      active.start(maxDurationMs.toLong())
    }

    AsyncFunction("stop") {
      current()?.stop()?.toMap()
    }

    Function("getStatus") {
      current()?.status()
    }

    Function("release") {
      replace(null)
    }

    OnDestroy { replace(null) }
  }

  private fun current(): PcmWavRecorder? = synchronized(this) { recorder }

  private fun replace(next: PcmWavRecorder?) {
    val previous = synchronized(this) { recorder.also { recorder = next } }
    if (previous !== next) previous?.release()
  }
}
