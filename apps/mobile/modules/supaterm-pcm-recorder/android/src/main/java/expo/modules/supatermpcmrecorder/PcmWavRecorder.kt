package expo.modules.supatermpcmrecorder

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import java.io.File
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

internal const val TARGET_SAMPLE_RATE = 16_000
private const val CHUNK_MILLIS = 20
private const val BUFFER_MILLIS = 400
private const val JOIN_TIMEOUT_MILLIS = 1_000L
private const val CAPTURE_FAILED = "The microphone stopped delivering audio."
private const val SAVE_FAILED = "The recording could not be saved."
private val CAPTURE_RATES = listOf(TARGET_SAMPLE_RATE, 48_000, 44_100)
private val AUDIO_SOURCES = listOf(
  MediaRecorder.AudioSource.VOICE_RECOGNITION,
  MediaRecorder.AudioSource.MIC
)

internal data class PcmRecording(val uri: String, val durationMs: Long) {
  fun toMap(): Map<String, Any> = mapOf("uri" to uri, "durationMs" to durationMs.toDouble())
}

/**
 * Captures mono PCM on a dedicated thread and writes 16 kHz WAV straight to disk, so no audio
 * crosses into JS. Devices that refuse 16 kHz capture at 48 or 44.1 kHz and are resampled.
 */
internal class PcmWavRecorder(
  private val file: File,
  private val onFinished: (Map<String, Any?>) -> Unit
) {
  val uri: String = Uri.fromFile(file).toString()
  private val released = AtomicBoolean(false)
  private var audioRecord: AudioRecord? = null
  private var captureRate = TARGET_SAMPLE_RATE
  private var worker: Thread? = null

  @Volatile private var capturing = false

  @Volatile private var frames = 0L

  @Volatile private var levelDecibels = SILENCE_DECIBELS

  fun prepare() {
    val (record, rate) = openAudioRecord() ?: error("The microphone could not be opened.")
    audioRecord = record
    captureRate = rate
  }

  fun start(maxDurationMs: Long) {
    val record = checkNotNull(audioRecord) { "The voice recorder is not prepared." }
    check(worker == null) { "The voice recorder is already recording." }
    val writer = WavFileWriter(file, TARGET_SAMPLE_RATE)
    try {
      record.startRecording()
      check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
        "The microphone is in use by another app."
      }
    } catch (error: IllegalStateException) {
      writer.close()
      throw error
    }
    capturing = true
    val maxFrames = maxDurationMs * TARGET_SAMPLE_RATE / 1_000
    val thread = Thread({ capture(record, writer, maxFrames) }, "SupatermPcmRecorder")
    worker = thread
    thread.start()
  }

  fun stop(): PcmRecording {
    halt()
    release()
    return PcmRecording(uri, frames * 1_000 / TARGET_SAMPLE_RATE)
  }

  fun release() {
    halt()
    if (released.compareAndSet(false, true)) {
      audioRecord?.release()
      audioRecord = null
    }
  }

  fun status(): Map<String, Any> = mapOf(
    "isRecording" to capturing,
    "durationMillis" to frames * 1_000.0 / TARGET_SAMPLE_RATE,
    "metering" to levelDecibels
  )

  private fun halt() {
    capturing = false
    val thread = worker ?: return
    thread.join(JOIN_TIMEOUT_MILLIS)
    if (thread.isAlive) {
      // A stalled input can block read(); stopping the record releases it.
      audioRecord?.let { stopAudioRecord(it) }
      thread.join(JOIN_TIMEOUT_MILLIS)
    }
    worker = null
  }

  private fun capture(record: AudioRecord, writer: WavFileWriter, maxFrames: Long) {
    val failure = try {
      writer.use { pump(record, it, maxFrames) }
    } catch (error: IOException) {
      error.message ?: SAVE_FAILED
    } catch (_: IllegalStateException) {
      CAPTURE_FAILED
    }
    stopAudioRecord(record)
    val stoppedByCaller = !capturing
    capturing = false
    if (failure != null || !stoppedByCaller) {
      onFinished(
        mapOf(
          "isFinished" to true,
          "hasError" to (failure != null),
          "error" to failure,
          "url" to uri
        )
      )
    }
  }

  private fun pump(record: AudioRecord, writer: WavFileWriter, maxFrames: Long): String? {
    val resampler = if (captureRate == TARGET_SAMPLE_RATE) {
      null
    } else {
      PcmResampler(captureRate, TARGET_SAMPLE_RATE)
    }
    val buffer = ShortArray(captureRate * CHUNK_MILLIS / 1_000)
    var failure: String? = null
    while (failure == null && capturing && writer.frames < maxFrames) {
      val read = record.read(buffer, 0, buffer.size)
      if (read < 0) {
        failure = CAPTURE_FAILED
      } else {
        levelDecibels = pcmLevelDecibels(buffer, read)
        val samples = resampler?.process(buffer, read) ?: buffer
        val available = if (resampler == null) read else samples.size
        writer.write(samples, minOf(available.toLong(), maxFrames - writer.frames).toInt())
        frames = writer.frames
      }
    }
    return failure
  }

  private fun stopAudioRecord(record: AudioRecord) {
    if (record.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
      runCatching { record.stop() }
    }
  }

  private fun openAudioRecord(): Pair<AudioRecord, Int>? =
    CAPTURE_RATES.firstNotNullOfOrNull { rate -> openAudioRecord(rate)?.let { it to rate } }

  private fun openAudioRecord(rate: Int): AudioRecord? {
    val minimum = AudioRecord.getMinBufferSize(
      rate,
      AudioFormat.CHANNEL_IN_MONO,
      AudioFormat.ENCODING_PCM_16BIT
    )
    if (minimum <= 0) return null
    val bufferBytes = maxOf(minimum, rate * BYTES_PER_SAMPLE * BUFFER_MILLIS / 1_000)
    return AUDIO_SOURCES.firstNotNullOfOrNull { source ->
      createAudioRecord(source, rate, bufferBytes)
    }
  }

  // The module checks RECORD_AUDIO before preparing.
  @SuppressLint("MissingPermission")
  private fun createAudioRecord(source: Int, rate: Int, bufferBytes: Int): AudioRecord? {
    val record = try {
      AudioRecord(
        source,
        rate,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufferBytes
      )
    } catch (_: IllegalArgumentException) {
      null
    }
    if (record?.state == AudioRecord.STATE_INITIALIZED) return record
    record?.release()
    return null
  }
}
