import Darwin
import Foundation
import Synchronization

nonisolated struct AgentTranscriptWatch: Sendable {
  enum Target: Sendable {
    case file
    case directory
  }

  let events: AsyncStream<Void>
  let target: Target
  let cancel: @Sendable () -> Void

  init(
    events: AsyncStream<Void>,
    target: Target = .file,
    cancel: @escaping @Sendable () -> Void = {}
  ) {
    let isCancelled = Mutex(false)
    self.events = events
    self.target = target
    self.cancel = {
      let shouldCancel = isCancelled.withLock { isCancelled in
        guard !isCancelled else { return false }
        isCancelled = true
        return true
      }
      if shouldCancel {
        cancel()
      }
    }
  }
}

nonisolated struct AgentTranscriptStream: Sendable {
  typealias Watch = @Sendable (String) -> AgentTranscriptWatch

  private let maxReadSize: Int
  private let maxLineSize: Int
  private let watch: Watch

  init(
    maxReadSize: Int = AgentTranscriptTailer.defaultMaxReadSize,
    maxLineSize: Int = AgentTranscriptTailer.defaultMaxLineSize,
    watch: @escaping Watch = AgentTranscriptFileEvents.watch(at:)
  ) {
    self.maxReadSize = maxReadSize
    self.maxLineSize = maxLineSize
    self.watch = watch
  }

  func updates(at path: String) -> AsyncStream<AgentTranscriptUpdate> {
    let initialWatch = watch(path)
    let state = AgentTranscriptStreamState(
      path: path,
      maxReadSize: maxReadSize,
      maxLineSize: maxLineSize,
      makeWatch: watch,
      watch: initialWatch
    )
    return AsyncStream(
      unfolding: {
        await state.next()
      },
      onCancel: {
        initialWatch.cancel()
        Task {
          await state.cancel()
        }
      }
    )
  }
}

private actor AgentTranscriptStreamState {
  private let path: String
  private let maxReadSize: Int
  private let maxLineSize: Int
  private let makeWatch: AgentTranscriptStream.Watch
  private var cursor: AgentTranscriptTailCursor?
  private var shouldRead = true
  private var hasAttemptedInitialRead = false
  private var isCancelled = false
  private var watch: AgentTranscriptWatch

  init(
    path: String,
    maxReadSize: Int,
    maxLineSize: Int,
    makeWatch: @escaping AgentTranscriptStream.Watch,
    watch: AgentTranscriptWatch
  ) {
    self.path = path
    self.maxReadSize = maxReadSize
    self.maxLineSize = maxLineSize
    self.makeWatch = makeWatch
    self.watch = watch
  }

  func next() async -> AgentTranscriptUpdate? {
    while !isCancelled && !Task.isCancelled {
      if shouldRead {
        let isInitialRead = !hasAttemptedInitialRead
        hasAttemptedInitialRead = true
        let watchTarget = watch.target
        let tick = read()
        shouldRead = tick?.hasUnreadBytes == true

        if isInitialRead || tick?.didReset == true
          || (tick != nil && watchTarget == .directory)
        {
          rewatch()
          shouldRead = true
        } else if tick == nil, watchTarget == .file {
          rewatch()
          shouldRead = true
        }

        if let tick {
          cursor = tick.cursor
          if !tick.objects.isEmpty || tick.didReset {
            return AgentTranscriptUpdate(tick)
          }
        }
        if shouldRead {
          continue
        }
      }

      let didReceiveEvent = await waitForEvent()
      guard !isCancelled, !Task.isCancelled else { return nil }
      if !didReceiveEvent || watch.target == .directory {
        rewatch()
      }
      shouldRead = true
    }
    return nil
  }

  func cancel() {
    isCancelled = true
    watch.cancel()
  }

  private func read() -> AgentTranscriptTailer.Tick? {
    if let cursor {
      return AgentTranscriptTailer.advance(
        cursor,
        at: path,
        maxReadSize: maxReadSize,
        maxLineSize: maxLineSize
      )
    }
    return AgentTranscriptTailer.start(
      at: path,
      maxReadSize: maxReadSize,
      maxLineSize: maxLineSize
    )
  }

  private func waitForEvent() async -> Bool {
    let events = watch.events
    for await _ in events {
      return true
    }
    return false
  }

  private func rewatch() {
    watch.cancel()
    watch = makeWatch(path)
  }
}

private nonisolated enum AgentTranscriptFileEvents {
  static func watch(at path: String) -> AgentTranscriptWatch {
    if let descriptor = descriptor(for: path) {
      return makeWatch(descriptor: descriptor, target: .file)
    }
    let url = URL(fileURLWithPath: path)
    var directoryURL = url.deletingLastPathComponent()
    while directoryURL.path != "/" {
      if let descriptor = descriptor(for: directoryURL.path) {
        return makeWatch(descriptor: descriptor, target: .directory)
      }
      directoryURL.deleteLastPathComponent()
    }
    guard let descriptor = descriptor(for: "/") else {
      return AgentTranscriptWatch(
        events: AsyncStream { $0.finish() },
        target: .directory
      )
    }
    return makeWatch(descriptor: descriptor, target: .directory)
  }

  private static func descriptor(for path: String) -> Int32? {
    let descriptor = open(path, O_EVTONLY)
    return descriptor >= 0 ? descriptor : nil
  }

  private static func makeWatch(
    descriptor: Int32,
    target: AgentTranscriptWatch.Target
  ) -> AgentTranscriptWatch {
    let source = DispatchSource.makeFileSystemObjectSource(
      fileDescriptor: descriptor,
      eventMask: [.write, .extend, .attrib, .rename, .delete, .revoke],
      queue: DispatchQueue(label: "agent-transcript-events")
    )
    let (events, continuation) = AsyncStream.makeStream(
      of: Void.self,
      bufferingPolicy: .bufferingNewest(1)
    )
    source.setEventHandler {
      continuation.yield()
    }
    source.setCancelHandler {
      close(descriptor)
      continuation.finish()
    }
    continuation.onTermination = { _ in
      source.cancel()
    }
    source.resume()
    return AgentTranscriptWatch(
      events: events,
      target: target,
      cancel: {
        source.cancel()
      }
    )
  }
}
