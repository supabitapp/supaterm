import AVFoundation
import ExpoModulesCore

private let statusEvent = "onStatus"
private let framesEvent = "onFrames"
private let recordingDirectory = "SupatermPcmRecorder"

/// One recording at a time; the JS voice controller already serializes sessions.
public final class SupatermPcmRecorderModule: Module {
  private let lock = NSLock()
  private var recorder: PcmWavRecorder?
  private var framesObserved = false

  public func definition() -> ModuleDefinition {
    Name("SupatermPcmRecorder")
    Events(statusEvent, framesEvent)

    OnStartObserving(framesEvent) { self.setFramesObserved(true) }
    OnStopObserving(framesEvent) { self.setFramesObserved(false) }

    AsyncFunction("prepare") { () throws -> [String: String] in
      guard AVAudioApplication.shared.recordPermission == .granted else {
        throw PcmRecorderError.permissionDenied
      }
      self.replace(nil)
      let directory = URL.cachesDirectory.appending(path: recordingDirectory, directoryHint: .isDirectory)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let url = directory.appending(path: "\(UUID().uuidString).wav")
      let uri = url.absoluteString
      let next = try PcmWavRecorder(
        url: url,
        onStatus: { [weak module = self] status in module?.sendEvent(statusEvent, status) },
        onFrames: { [weak module = self] pcm in module?.sendFrames(uri: uri, pcm: pcm) }
      )
      self.replace(next)
      return ["uri": uri]
    }

    Function("record") { (maxDurationMs: Double) throws in
      guard let active = self.current() else { throw PcmRecorderError.notPrepared }
      try active.start(maxDurationMs: maxDurationMs)
    }

    AsyncFunction("stop") { () throws -> [String: Any]? in
      try self.current()?.stop()
    }

    Function("getStatus") { () -> [String: Any]? in
      self.current()?.status()
    }

    Function("getAvailableInputs") { () -> [[String: String]] in
      (AVAudioSession.sharedInstance().availableInputs ?? []).map { port in
        ["uid": port.uid, "name": port.portName, "type": port.portType.rawValue]
      }
    }

    Function("setInput") { (uid: String) throws in
      let session = AVAudioSession.sharedInstance()
      guard let port = session.availableInputs?.first(where: { $0.uid == uid }) else {
        throw PcmRecorderError.inputUnavailable
      }
      try session.setPreferredInput(port)
    }

    Function("release") {
      self.replace(nil)
    }

    OnDestroy { self.replace(nil) }
  }

  private func sendFrames(uri: String, pcm: Data) {
    guard lock.withLock({ framesObserved }) else { return }
    sendEvent(framesEvent, ["url": uri, "pcm": pcm.base64EncodedString()])
  }

  private func setFramesObserved(_ observed: Bool) {
    lock.withLock { framesObserved = observed }
  }

  private func current() -> PcmWavRecorder? {
    lock.withLock { recorder }
  }

  private func replace(_ next: PcmWavRecorder?) {
    let previous = lock.withLock {
      let previous = recorder
      recorder = next
      return previous
    }
    if previous !== next { previous?.release() }
  }
}
