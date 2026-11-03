import AVFoundation

private let targetSampleRate = 16_000.0
private let bytesPerSample = 2
private let frameBatchBytes = 3_200
private let silenceDecibels = -160.0
private let captureFailed = "The microphone stopped delivering audio."
private let mediaServicesReset = "Media services were reset by the system."

enum PcmRecorderError: LocalizedError {
  case permissionDenied
  case notPrepared
  case alreadyRecording
  case noMicrophone
  case inputUnavailable
  case saveFailed

  var errorDescription: String? {
    switch self {
    case .permissionDenied: "Microphone access is required for voice input."
    case .notPrepared: "The voice recorder is not prepared."
    case .alreadyRecording: "The voice recorder is already recording."
    case .noMicrophone: "The microphone could not be opened."
    case .inputUnavailable: "That microphone is no longer connected."
    case .saveFailed: "The recording could not be saved."
    }
  }
}

/// Captures the input through an AVAudioEngine tap and writes 16 kHz mono 16-bit WAV. `onFrames`
/// receives the same bytes in order, about 100 ms at a time, for streaming. The app's JS audio
/// session owns the AVAudioSession category and activation, so this never sets them.
final class PcmWavRecorder {
  private let url: URL
  private let engine = AVAudioEngine()
  private let targetFormat: AVAudioFormat
  private let queue = DispatchQueue(label: "com.supaterm.pcm-recorder")
  private let onStatus: ([String: Any?]) -> Void
  private let onFrames: (Data) -> Void

  // Everything below is confined to `queue`.
  private var writer: WavFileWriter?
  private var tapInstalled = false
  private var capturing = false
  private var interrupted = false
  private var finished = false
  private var stopping = false
  private var saveFailed = false
  private var dataBytes = 0
  private var maxBytes = 0
  private var levelDecibels = silenceDecibels
  private var pending = Data()
  private var observers: [NSObjectProtocol] = []

  init(
    url: URL,
    onStatus: @escaping ([String: Any?]) -> Void,
    onFrames: @escaping (Data) -> Void
  ) throws {
    guard
      let format = AVAudioFormat(
        commonFormat: .pcmFormatInt16, sampleRate: targetSampleRate, channels: 1, interleaved: true)
    else { throw PcmRecorderError.noMicrophone }
    self.url = url
    self.targetFormat = format
    self.onStatus = onStatus
    self.onFrames = onFrames
  }

  func start(maxDurationMs: Double) throws {
    try queue.sync {
      guard writer == nil, !finished else { throw PcmRecorderError.alreadyRecording }
      let writer = try WavFileWriter(url: url, sampleRate: Int(targetSampleRate))
      do {
        try startEngine()
      } catch {
        removeTap()
        try? writer.close()
        throw error
      }
      self.writer = writer
      maxBytes = Int(maxDurationMs * targetSampleRate / 1_000) * bytesPerSample
      capturing = true
      observeSession()
    }
  }

  func stop() throws -> [String: Any] {
    // A tap still converting when the engine stops queues its samples behind this; they land first.
    queue.sync {
      stopping = true
      engine.stop()
      removeTap()
    }
    return try queue.sync {
      teardown()
      if saveFailed { throw PcmRecorderError.saveFailed }
      return ["uri": url.absoluteString, "durationMs": durationMs]
    }
  }

  func release() {
    queue.sync { _ = teardown() }
  }

  func status() -> [String: Any] {
    queue.sync {
      ["isRecording": capturing && !interrupted, "durationMillis": durationMs, "metering": levelDecibels]
    }
  }

  private var durationMs: Double {
    Double(dataBytes / bytesPerSample) * 1_000 / targetSampleRate
  }

  private func startEngine() throws {
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0,
      let converter = AVAudioConverter(from: format, to: targetFormat)
    else { throw PcmRecorderError.noMicrophone }
    converter.downmix = true
    let targetFormat = targetFormat
    let bufferSize = AVAudioFrameCount(format.sampleRate / 10)
    input.installTap(onBus: 0, bufferSize: bufferSize, format: format) { [weak self] buffer, _ in
      guard let pcm = Self.convert(buffer, with: converter, to: targetFormat) else {
        self?.queue.async { self?.end(failure: captureFailed) }
        return
      }
      guard !pcm.isEmpty else { return }
      self?.queue.async { self?.append(pcm) }
    }
    tapInstalled = true
    engine.prepare()
    try engine.start()
  }

  private func removeTap() {
    guard tapInstalled else { return }
    engine.inputNode.removeTap(onBus: 0)
    tapInstalled = false
  }

  /// A new route can change the input format, so the tap is rebuilt for it.
  private func restart() {
    guard !stopping else { return }
    engine.stop()
    removeTap()
    do {
      try startEngine()
    } catch {
      end(failure: captureFailed)
    }
  }

  private func append(_ pcm: Data) {
    guard capturing, !interrupted, let writer else { return }
    let chunk = pcm.prefix(maxBytes - dataBytes)
    do {
      try writer.write(chunk)
    } catch {
      end(failure: PcmRecorderError.saveFailed.errorDescription)
      return
    }
    dataBytes += chunk.count
    levelDecibels = Self.decibels(chunk)
    pending.append(chunk)
    if pending.count >= frameBatchBytes { flushFrames() }
    if dataBytes >= maxBytes { end(failure: nil) }
  }

  private func flushFrames() {
    guard !pending.isEmpty else { return }
    onFrames(pending)
    pending = Data()
  }

  /// Stops on its own: the duration limit, a failure, or a reset the recording can't survive.
  private func end(failure: String?) {
    guard teardown() else { return }
    let failure = failure ?? (saveFailed ? PcmRecorderError.saveFailed.errorDescription : nil)
    onStatus([
      "isFinished": true,
      "hasError": failure != nil,
      "error": failure,
      "url": url.absoluteString,
    ])
  }

  @discardableResult
  private func teardown() -> Bool {
    guard !finished else { return false }
    finished = true
    capturing = false
    for observer in observers { NotificationCenter.default.removeObserver(observer) }
    observers = []
    engine.stop()
    removeTap()
    flushFrames()
    do {
      try writer?.close()
    } catch {
      saveFailed = true
    }
    return true
  }

  private func observeSession() {
    let center = NotificationCenter.default
    let session = AVAudioSession.sharedInstance()
    observers = [
      center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: nil) { [weak self] notification in
        guard let self,
          let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
          let type = AVAudioSession.InterruptionType(rawValue: raw)
        else { return }
        let options = AVAudioSession.InterruptionOptions(
          rawValue: notification.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
        self.queue.async { self.interruption(type, options: options) }
      },
      center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil) { [weak self] _ in
        self?.queue.async {
          guard let self, self.capturing, !self.interrupted else { return }
          self.restart()
        }
      },
      center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: session, queue: nil) { [weak self] _ in
        self?.queue.async { self?.end(failure: mediaServicesReset) }
      },
    ]
  }

  /// Pauses through a call or Siri and resumes when the system says to, as AVAudioRecorder did.
  private func interruption(_ type: AVAudioSession.InterruptionType, options: AVAudioSession.InterruptionOptions) {
    guard capturing else { return }
    switch type {
    case .began:
      interrupted = true
    case .ended:
      guard interrupted, options.contains(.shouldResume) else { return }
      interrupted = false
      restart()
    @unknown default:
      break
    }
  }

  /// Nil when the conversion failed; empty when the converter holds the samples for later.
  private static func convert(
    _ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat
  ) -> Data? {
    let ratio = format.sampleRate / buffer.format.sampleRate
    let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up)) + 64
    guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
    var pcm = Data()
    var supplied = false
    var status: AVAudioConverterOutputStatus
    repeat {
      output.frameLength = 0
      var error: NSError?
      status = converter.convert(to: output, error: &error) { _, inputStatus in
        if supplied {
          inputStatus.pointee = .noDataNow
          return nil
        }
        supplied = true
        inputStatus.pointee = .haveData
        return buffer
      }
      if status == .error { return nil }
      if let samples = output.int16ChannelData, output.frameLength > 0 {
        pcm.append(Data(bytes: samples[0], count: Int(output.frameLength) * bytesPerSample))
      }
    } while status == .haveData
    return pcm
  }

  private static func decibels(_ pcm: Data) -> Double {
    let count = pcm.count / bytesPerSample
    guard count > 0 else { return silenceDecibels }
    let sum = pcm.withUnsafeBytes { raw in
      (0..<count).reduce(0.0) { total, index in
        let sample = Double(raw.loadUnaligned(fromByteOffset: index * bytesPerSample, as: Int16.self)) / 32_768
        return total + sample * sample
      }
    }
    let rms = (sum / Double(count)).squareRoot()
    return rms > 0 ? max(20 * log10(rms), silenceDecibels) : silenceDecibels
  }
}

/// Mono 16-bit PCM WAV. The header is rewritten with the final sizes on close.
final class WavFileWriter {
  private let handle: FileHandle
  private let sampleRate: Int
  private var dataBytes = 0

  init(url: URL, sampleRate: Int) throws {
    self.sampleRate = sampleRate
    let header = Self.header(dataBytes: 0, sampleRate: sampleRate)
    guard FileManager.default.createFile(atPath: url.path(percentEncoded: false), contents: header) else {
      throw PcmRecorderError.saveFailed
    }
    handle = try FileHandle(forWritingTo: url)
    try handle.seekToEnd()
  }

  func write(_ pcm: Data) throws {
    try handle.write(contentsOf: pcm)
    dataBytes += pcm.count
  }

  func close() throws {
    defer { try? handle.close() }
    try handle.seek(toOffset: 0)
    try handle.write(contentsOf: Self.header(dataBytes: dataBytes, sampleRate: sampleRate))
    try handle.synchronize()
  }

  private static func header(dataBytes: Int, sampleRate: Int) -> Data {
    var data = Data(capacity: 44)
    func ascii(_ text: String) { data.append(contentsOf: Array(text.utf8)) }
    func little<T: FixedWidthInteger>(_ value: T) {
      withUnsafeBytes(of: value.littleEndian) { data.append(contentsOf: $0) }
    }
    ascii("RIFF")
    little(UInt32(36 + dataBytes))
    ascii("WAVE")
    ascii("fmt ")
    little(UInt32(16))
    little(UInt16(1))
    little(UInt16(1))
    little(UInt32(sampleRate))
    little(UInt32(sampleRate * bytesPerSample))
    little(UInt16(bytesPerSample))
    little(UInt16(16))
    ascii("data")
    little(UInt32(dataBytes))
    return data
  }
}
