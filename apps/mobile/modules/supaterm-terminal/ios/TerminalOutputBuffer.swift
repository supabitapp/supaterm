import Foundation

final class TerminalOutputBuffer {
  private var storage = Data()
  private var retainedStart = 0
  private let limit = 512 * 1024

  var data: Data { storage.subdata(in: retainedStart..<storage.count) }

  func write(_ incoming: Data, reset: Bool) {
    if reset || incoming.count >= limit {
      storage = incoming.subdata(in: max(0, incoming.count - limit)..<incoming.count)
      retainedStart = 0
    } else {
      storage.append(incoming)
      retainedStart = max(retainedStart, storage.count - limit)
    }
    while retainedStart < storage.count && storage[retainedStart] & 0xC0 == 0x80 {
      retainedStart += 1
    }

    if retainedStart >= limit {
      storage = storage.subdata(in: retainedStart..<storage.count)
      retainedStart = 0
    }
  }
}
