import Foundation
import Synchronization
import Testing

@testable import supaterm

struct AgentTranscriptTailerTests {
  private func makeTranscript(_ contents: String) throws -> String {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("tailer-\(UUID().uuidString).jsonl")
    try Data(contents.utf8).write(to: url)
    return url.path
  }

  @Test
  func startReturnsNilForMissingFile() {
    #expect(AgentTranscriptTailer.start(at: "/nonexistent/transcript.jsonl") == nil)
  }

  @Test
  func startSkipsPartialTrailingLine() throws {
    let path = try makeTranscript(
      """
      {"type":"one"}
      {"type":"two"}
      {"type":"par
      """
    )

    let tick = try #require(AgentTranscriptTailer.start(at: path))

    #expect(tick.objects.map { $0["type"]?.stringValue } == ["one", "two"])
    #expect(!tick.didReset)
  }

  @Test
  func advanceConsumesLineOnceNewlineArrives() throws {
    let path = try makeTranscript("{\"type\":\"one\"}\n{\"type\":\"par")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    #expect(started.objects.count == 1)

    try Data("{\"type\":\"one\"}\n{\"type\":\"partial\"}\n".utf8)
      .write(to: URL(fileURLWithPath: path))

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["partial"])
    #expect(!tick.didReset)
  }

  @Test
  func boundedReadsCarryIncompleteLinesAcrossChunks() throws {
    let contents = "{\"type\":\"bounded\"}\n"
    let path = try makeTranscript(contents)

    let first = try #require(AgentTranscriptTailer.start(at: path, maxReadSize: 8))
    #expect(first.cursor.offset == 0)
    #expect(first.objects.isEmpty)

    let second = try #require(
      AgentTranscriptTailer.advance(first.cursor, at: path, maxReadSize: 8)
    )
    #expect(second.cursor.offset == 0)
    #expect(second.objects.isEmpty)

    let third = try #require(
      AgentTranscriptTailer.advance(second.cursor, at: path, maxReadSize: 8)
    )
    #expect(third.cursor.offset == UInt64(contents.utf8.count))
    #expect(third.objects.map { $0["type"]?.stringValue } == ["bounded"])
  }

  @Test
  func advanceRestartsFromZeroWhenFileTruncates() throws {
    let path = try makeTranscript("{\"type\":\"one\"}\n{\"type\":\"two\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    #expect(started.objects.count == 2)

    try Data("{\"type\":\"fresh\"}\n".utf8).write(to: URL(fileURLWithPath: path))

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))
    #expect(tick.didReset)
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["fresh"])
    #expect(tick.cursor.offset == UInt64("{\"type\":\"fresh\"}\n".utf8.count))
  }

  @Test
  func advanceRestartsWhenFileTruncatesAndRegrowsPastReadOffset() throws {
    let path = try makeTranscript("{\"type\":\"old\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
    try handle.truncate(atOffset: 0)
    try handle.write(contentsOf: Data("{\"type\":\"fresh-one\"}\n{\"type\":\"fresh-two\"}\n".utf8))
    try handle.close()

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))

    #expect(tick.didReset)
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["fresh-one", "fresh-two"])
  }

  @Test
  func advanceRestartsWhenSameFileContentsAreRewritten() throws {
    let path = try makeTranscript("{\"type\":\"old\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
    try handle.seek(toOffset: 0)
    try handle.write(contentsOf: Data("{\"type\":\"new\"}\n".utf8))
    try handle.close()

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))

    #expect(tick.didReset)
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["new"])
  }

  @Test
  func advanceRestartsFromZeroWhenFileIsReplacedByLargerFile() throws {
    let path = try makeTranscript("{\"type\":\"old\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    let replacementURL = URL(fileURLWithPath: path + ".replacement")
    try Data("{\"type\":\"fresh-one\"}\n{\"type\":\"fresh-two\"}\n".utf8).write(
      to: replacementURL
    )
    _ = try FileManager.default.replaceItemAt(
      URL(fileURLWithPath: path),
      withItemAt: replacementURL
    )

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))

    #expect(tick.didReset)
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["fresh-one", "fresh-two"])
  }

  @Test
  func advanceRestartsFromZeroWhenFileIsReplacedBySameSizeFile() throws {
    let path = try makeTranscript("{\"type\":\"old\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    let replacementURL = URL(fileURLWithPath: path + ".replacement")
    try Data("{\"type\":\"new\"}\n".utf8).write(to: replacementURL)
    _ = try FileManager.default.replaceItemAt(
      URL(fileURLWithPath: path),
      withItemAt: replacementURL
    )

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))

    #expect(tick.didReset)
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["new"])
  }

  @Test
  func advanceReturnsNilWhenFileDisappears() throws {
    let path = try makeTranscript("{\"type\":\"one\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))

    try FileManager.default.removeItem(atPath: path)

    #expect(AgentTranscriptTailer.advance(started.cursor, at: path) == nil)
  }

  @Test
  func nonObjectLinesAreSkipped() throws {
    let path = try makeTranscript(
      """
      [1,2,3]
      not json
      {"type":"kept"}
      """ + "\n"
    )

    let tick = try #require(AgentTranscriptTailer.start(at: path))
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["kept"])
  }

  @Test
  func oversizedLinesAreDiscardedWithoutBlockingLaterObjects() throws {
    let contents = String(repeating: "x", count: 32) + "\n{\"type\":\"kept\"}\n"
    let path = try makeTranscript(contents)
    var tick = try #require(
      AgentTranscriptTailer.start(at: path, maxReadSize: 3, maxLineSize: 24)
    )
    var objects = tick.objects

    while tick.hasUnreadBytes {
      tick = try #require(
        AgentTranscriptTailer.advance(
          tick.cursor,
          at: path,
          maxReadSize: 3,
          maxLineSize: 24
        )
      )
      objects.append(contentsOf: tick.objects)
    }

    #expect(objects.map { $0["type"]?.stringValue } == ["kept"])
    #expect(tick.cursor.offset == UInt64(contents.utf8.count))
  }

  @Test
  func streamReadsInitialAndAppendedObjectsFromWatchEvents() async throws {
    let path = try makeTranscript("{\"type\":\"initial\"}\n")
    let (changes, continuation) = AsyncStream.makeStream(
      of: Void.self,
      bufferingPolicy: .bufferingNewest(1)
    )
    defer { continuation.finish() }
    let stream = AgentTranscriptStream(
      maxReadSize: 8,
      watch: { _ in AgentTranscriptWatch(events: changes) }
    )
    var iterator = stream.updates(at: path).makeAsyncIterator()

    let initial = try #require(await iterator.next())
    #expect(initial.objects.map { $0["type"]?.stringValue } == ["initial"])

    let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
    try handle.seekToEnd()
    try handle.write(contentsOf: Data("{\"type\":\"appended\"}\n".utf8))
    try handle.close()
    continuation.yield()

    let appended = try #require(await iterator.next())
    #expect(appended.objects.map { $0["type"]?.stringValue } == ["appended"])
  }

  @Test
  func streamDrainsWritesMadeWhileInitialWatcherIsRearmed() async throws {
    let path = try makeTranscript("{\"type\":\"initial\"}\n")
    let (events, continuation) = AsyncStream.makeStream(of: Void.self)
    defer { continuation.finish() }
    let watchCount = Mutex(0)
    let writeError = Mutex<String?>(nil)
    let stream = AgentTranscriptStream(
      watch: { _ in
        let count = watchCount.withLock {
          $0 += 1
          return $0
        }
        if count == 2 {
          do {
            let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
            try handle.seekToEnd()
            try handle.write(contentsOf: Data("{\"type\":\"during-rearm\"}\n".utf8))
            try handle.close()
          } catch {
            writeError.withLock { $0 = String(describing: error) }
          }
        }
        return AgentTranscriptWatch(events: events)
      }
    )
    var iterator = stream.updates(at: path).makeAsyncIterator()

    let initial = try #require(await iterator.next())
    let duringRearm = try #require(await iterator.next())

    #expect(initial.objects.map { $0["type"]?.stringValue } == ["initial"])
    #expect(duringRearm.objects.map { $0["type"]?.stringValue } == ["during-rearm"])
    #expect(writeError.withLock { $0 } == nil)
  }

  @Test
  func streamRearmsWatcherAfterAtomicReplacement() async throws {
    let path = try makeTranscript("{\"type\":\"old\"}\n")
    let (firstEvents, firstContinuation) = AsyncStream.makeStream(
      of: Void.self,
      bufferingPolicy: .bufferingNewest(1)
    )
    let (secondEvents, secondContinuation) = AsyncStream.makeStream(
      of: Void.self,
      bufferingPolicy: .bufferingNewest(1)
    )
    let (thirdEvents, thirdContinuation) = AsyncStream.makeStream(
      of: Void.self,
      bufferingPolicy: .bufferingNewest(1)
    )
    defer {
      firstContinuation.finish()
      secondContinuation.finish()
      thirdContinuation.finish()
    }
    let watches = Mutex([
      AgentTranscriptWatch(events: firstEvents),
      AgentTranscriptWatch(events: secondEvents),
      AgentTranscriptWatch(events: thirdEvents),
    ])
    let stream = AgentTranscriptStream(
      watch: { _ in watches.withLock { $0.removeFirst() } }
    )
    var iterator = stream.updates(at: path).makeAsyncIterator()
    _ = await iterator.next()

    let replacementURL = URL(fileURLWithPath: path + ".replacement")
    try Data("{\"type\":\"fresh\"}\n".utf8).write(to: replacementURL)
    _ = try FileManager.default.replaceItemAt(
      URL(fileURLWithPath: path),
      withItemAt: replacementURL
    )
    secondContinuation.yield()

    let replacement = try #require(await iterator.next())
    #expect(replacement.didReset)
    #expect(replacement.objects.map { $0["type"]?.stringValue } == ["fresh"])

    let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
    try handle.seekToEnd()
    try handle.write(contentsOf: Data("{\"type\":\"later\"}\n".utf8))
    try handle.close()
    thirdContinuation.yield()

    let later = try #require(await iterator.next())
    #expect(later.objects.map { $0["type"]?.stringValue } == ["later"])
  }

  @Test
  func streamDrainsWritesMadeWhileReplacementWatcherIsRearmed() async throws {
    let path = try makeTranscript("{\"type\":\"old\"}\n")
    let (firstEvents, firstContinuation) = AsyncStream.makeStream(of: Void.self)
    let (secondEvents, secondContinuation) = AsyncStream.makeStream(of: Void.self)
    let (thirdEvents, thirdContinuation) = AsyncStream.makeStream(of: Void.self)
    defer {
      firstContinuation.finish()
      secondContinuation.finish()
      thirdContinuation.finish()
    }
    let watchCount = Mutex(0)
    let writeError = Mutex<String?>(nil)
    let stream = AgentTranscriptStream(
      watch: { _ in
        let count = watchCount.withLock {
          $0 += 1
          return $0
        }
        if count == 3 {
          do {
            let handle = try FileHandle(forWritingTo: URL(fileURLWithPath: path))
            try handle.seekToEnd()
            try handle.write(contentsOf: Data("{\"type\":\"during-rearm\"}\n".utf8))
            try handle.close()
          } catch {
            writeError.withLock { $0 = String(describing: error) }
          }
        }
        switch count {
        case 1:
          return AgentTranscriptWatch(events: firstEvents)
        case 2:
          return AgentTranscriptWatch(events: secondEvents)
        default:
          return AgentTranscriptWatch(events: thirdEvents)
        }
      }
    )
    var iterator = stream.updates(at: path).makeAsyncIterator()
    _ = await iterator.next()
    let replacementURL = URL(fileURLWithPath: path + ".replacement")
    try Data("{\"type\":\"fresh\"}\n".utf8).write(to: replacementURL)
    _ = try FileManager.default.replaceItemAt(
      URL(fileURLWithPath: path),
      withItemAt: replacementURL
    )
    secondContinuation.yield()

    let replacement = try #require(await iterator.next())
    let duringRearm = try #require(await iterator.next())

    #expect(replacement.objects.map { $0["type"]?.stringValue } == ["fresh"])
    #expect(duringRearm.objects.map { $0["type"]?.stringValue } == ["during-rearm"])
    #expect(writeError.withLock { $0 } == nil)
  }

  @Test
  func streamSurvivesWatcherTerminationAndFileRecreation() async throws {
    let path = try makeTranscript("{\"type\":\"old\"}\n")
    let (firstEvents, firstContinuation) = AsyncStream.makeStream(of: Void.self)
    let (secondEvents, secondContinuation) = AsyncStream.makeStream(of: Void.self)
    let (laterEvents, laterContinuation) = AsyncStream.makeStream(of: Void.self)
    defer {
      firstContinuation.finish()
      secondContinuation.finish()
      laterContinuation.finish()
    }
    let watchCount = Mutex(0)
    let recreationError = Mutex<String?>(nil)
    let stream = AgentTranscriptStream(
      watch: { _ in
        let count = watchCount.withLock {
          $0 += 1
          return $0
        }
        switch count {
        case 1:
          return AgentTranscriptWatch(events: firstEvents)
        case 2:
          return AgentTranscriptWatch(events: secondEvents)
        default:
          if count == 3 {
            do {
              try Data("{\"type\":\"recreated\"}\n".utf8).write(
                to: URL(fileURLWithPath: path)
              )
            } catch {
              recreationError.withLock { $0 = String(describing: error) }
            }
          }
          return AgentTranscriptWatch(events: laterEvents)
        }
      }
    )
    var iterator = stream.updates(at: path).makeAsyncIterator()
    _ = await iterator.next()

    try FileManager.default.removeItem(atPath: path)
    secondContinuation.finish()

    let recreated = try #require(await iterator.next())

    #expect(recreated.didReset)
    #expect(recreated.objects.map { $0["type"]?.stringValue } == ["recreated"])
    #expect(recreationError.withLock { $0 } == nil)
  }

  @Test
  func streamDrainsFileCreatedWhileDirectoryWatcherIsRearmed() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("tailer-directory-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let path = directory.appendingPathComponent("transcript.jsonl").path
    let (events, continuation) = AsyncStream.makeStream(of: Void.self)
    defer { continuation.finish() }
    let watchCount = Mutex(0)
    let creationError = Mutex<String?>(nil)
    let stream = AgentTranscriptStream(
      watch: { _ in
        let count = watchCount.withLock {
          $0 += 1
          return $0
        }
        if count == 2 {
          do {
            try Data("{\"type\":\"created\"}\n".utf8).write(
              to: URL(fileURLWithPath: path)
            )
          } catch {
            creationError.withLock { $0 = String(describing: error) }
          }
        }
        return AgentTranscriptWatch(
          events: events,
          target: count == 1 ? .directory : .file
        )
      }
    )
    var iterator = stream.updates(at: path).makeAsyncIterator()

    let created = try #require(await iterator.next())

    #expect(created.objects.map { $0["type"]?.stringValue } == ["created"])
    #expect(creationError.withLock { $0 } == nil)
  }

  @Test
  func streamWaitsAfterOneMissingFileDrainUntilDirectoryEvent() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("tailer-wait-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let path = directory.appendingPathComponent("transcript.jsonl").path
    let (events, continuation) = AsyncStream.makeStream(of: Void.self)
    defer { continuation.finish() }
    let watchCount = Mutex(0)
    let stream = AgentTranscriptStream(
      watch: { _ in
        watchCount.withLock { $0 += 1 }
        return AgentTranscriptWatch(
          events: events,
          target: FileManager.default.fileExists(atPath: path) ? .file : .directory
        )
      }
    )
    let task = Task {
      var iterator = stream.updates(at: path).makeAsyncIterator()
      return await iterator.next()
    }

    while watchCount.withLock({ $0 }) < 2 {
      await Task.yield()
    }
    for _ in 0..<10 {
      await Task.yield()
    }

    #expect(watchCount.withLock { $0 } == 2)

    try Data("{\"type\":\"created\"}\n".utf8).write(to: URL(fileURLWithPath: path))
    continuation.yield()
    let created = try #require(await task.value)

    #expect(created.objects.map { $0["type"]?.stringValue } == ["created"])
  }

  @Test
  func streamRearmsAtNewlyCreatedIntermediateDirectory() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("tailer-nested-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let nestedDirectory = directory.appendingPathComponent("session")
    let path = nestedDirectory.appendingPathComponent("transcript.jsonl").path
    let (events, continuation) = AsyncStream.makeStream(of: Void.self)
    defer { continuation.finish() }
    let watchCount = Mutex(0)
    let stream = AgentTranscriptStream(
      watch: { _ in
        watchCount.withLock { $0 += 1 }
        return AgentTranscriptWatch(events: events, target: .directory)
      }
    )
    let task = Task {
      var iterator = stream.updates(at: path).makeAsyncIterator()
      return await iterator.next()
    }

    while watchCount.withLock({ $0 }) < 2 {
      await Task.yield()
    }
    try FileManager.default.createDirectory(at: nestedDirectory, withIntermediateDirectories: false)
    continuation.yield()
    for _ in 0..<100 where watchCount.withLock({ $0 }) < 3 {
      await Task.yield()
    }

    #expect(watchCount.withLock { $0 } == 3)
    task.cancel()
  }

  @Test
  func cancellingTranscriptStreamCancelsWatcher() async {
    let cancellationCount = Mutex(0)
    let (events, continuation) = AsyncStream.makeStream(
      of: Void.self,
      bufferingPolicy: .bufferingNewest(1)
    )
    defer { continuation.finish() }
    let watch = AgentTranscriptWatch(
      events: events,
      target: .directory,
      cancel: {
        cancellationCount.withLock { $0 += 1 }
      }
    )
    let stream = AgentTranscriptStream(watch: { _ in watch })
    let task = Task {
      var iterator = stream.updates(at: "/nonexistent/transcript.jsonl").makeAsyncIterator()
      return await iterator.next()
    }

    await Task.yield()
    task.cancel()
    _ = await task.value

    #expect(cancellationCount.withLock { $0 } == 1)
  }
}
