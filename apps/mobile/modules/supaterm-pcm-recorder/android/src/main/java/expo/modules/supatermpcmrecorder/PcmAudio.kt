package expo.modules.supatermpcmrecorder

import java.io.Closeable
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

private const val WAV_HEADER_BYTES = 44
internal const val BYTES_PER_SAMPLE = 2
private const val PCM_FORMAT: Short = 1
private const val MONO: Short = 1
private const val BITS_PER_SAMPLE: Short = 16
private const val FMT_CHUNK_BYTES = 16
private const val FILTER_TAPS = 63
internal const val SILENCE_DECIBELS = -160.0

/** Mono 16-bit PCM WAV. The header is rewritten with the final sizes on close. */
internal class WavFileWriter(file: File, private val sampleRate: Int) : Closeable {
  private val output = RandomAccessFile(file, "rw")

  var frames = 0L
    private set

  init {
    output.setLength(0)
    output.write(header(0))
  }

  fun write(samples: ShortArray, count: Int) {
    if (count <= 0) return
    val bytes = ByteBuffer.allocate(count * BYTES_PER_SAMPLE).order(ByteOrder.LITTLE_ENDIAN)
    for (index in 0 until count) bytes.putShort(samples[index])
    output.write(bytes.array())
    frames += count
  }

  override fun close() {
    output.use {
      it.seek(0)
      it.write(header(frames * BYTES_PER_SAMPLE))
      it.fd.sync()
    }
  }

  private fun header(dataBytes: Long): ByteArray {
    val size = dataBytes.coerceAtMost(Int.MAX_VALUE.toLong() - WAV_HEADER_BYTES).toInt()
    return ByteBuffer.allocate(WAV_HEADER_BYTES)
      .order(ByteOrder.LITTLE_ENDIAN)
      .put("RIFF".toByteArray(Charsets.US_ASCII))
      .putInt(WAV_HEADER_BYTES - 8 + size)
      .put("WAVE".toByteArray(Charsets.US_ASCII))
      .put("fmt ".toByteArray(Charsets.US_ASCII))
      .putInt(FMT_CHUNK_BYTES)
      .putShort(PCM_FORMAT)
      .putShort(MONO)
      .putInt(sampleRate)
      .putInt(sampleRate * BYTES_PER_SAMPLE)
      .putShort(BYTES_PER_SAMPLE.toShort())
      .putShort(BITS_PER_SAMPLE)
      .put("data".toByteArray(Charsets.US_ASCII))
      .putInt(size)
      .array()
  }
}

/**
 * Streaming low-pass then linear-interpolation resampler for devices that cannot capture at the
 * target rate. The filter removes content above the output Nyquist so it does not alias into
 * the speech band.
 */
internal class PcmResampler(inputRate: Int, outputRate: Int) {
  private val step = inputRate.toDouble() / outputRate
  private val taps = lowPassTaps(0.45 * outputRate / inputRate)
  private val history = FloatArray(FILTER_TAPS - 1)
  private var position = 0.0
  private var previous = 0f

  fun process(input: ShortArray, count: Int): ShortArray {
    if (count <= 0) return ShortArray(0)
    val filtered = filter(input, count)
    val output = ShortArray(floor((count - position) / step).toInt() + 1)
    var produced = 0
    while (position < count - 1 && produced < output.size) {
      val base = floor(position).toInt()
      val fraction = (position - base).toFloat()
      val start = if (base < 0) previous else filtered[base]
      val value = start + (filtered[base + 1] - start) * fraction
      output[produced] = value.roundToInt().coerceIn(-32768, 32767).toShort()
      produced += 1
      position += step
    }
    previous = filtered[count - 1]
    position -= count
    return if (produced == output.size) output else output.copyOf(produced)
  }

  private fun filter(input: ShortArray, count: Int): FloatArray {
    val filtered = FloatArray(count)
    for (index in 0 until count) {
      var sum = 0.0
      for (tap in taps.indices) {
        val sourceIndex = index - tap
        val sample = if (sourceIndex >= 0) {
          input[sourceIndex].toFloat()
        } else {
          history[history.size + sourceIndex]
        }
        sum += taps[tap] * sample
      }
      filtered[index] = sum.toFloat()
    }
    val keep = minOf(count, history.size)
    history.copyInto(history, 0, keep, history.size)
    for (index in 0 until keep) {
      history[history.size - keep + index] = input[count - keep + index].toFloat()
    }
    return filtered
  }

  private fun lowPassTaps(cutoff: Double): DoubleArray {
    val center = (FILTER_TAPS - 1) / 2.0
    val raw = DoubleArray(FILTER_TAPS) { index ->
      val offset = index - center
      val sinc = if (offset == 0.0) 2 * cutoff else sin(2 * PI * cutoff * offset) / (PI * offset)
      sinc * (0.54 - 0.46 * cos(2 * PI * index / (FILTER_TAPS - 1)))
    }
    val gain = raw.sum()
    return DoubleArray(FILTER_TAPS) { raw[it] / gain }
  }
}

internal fun pcmLevelDecibels(samples: ShortArray, count: Int): Double {
  if (count <= 0) return SILENCE_DECIBELS
  var sum = 0.0
  for (index in 0 until count) {
    val sample = samples[index] / 32768.0
    sum += sample * sample
  }
  val rms = sqrt(sum / count)
  return if (rms > 0) (20 * log10(rms)).coerceAtLeast(SILENCE_DECIBELS) else SILENCE_DECIBELS
}
