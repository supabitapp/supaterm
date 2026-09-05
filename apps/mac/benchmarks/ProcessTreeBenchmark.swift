import Foundation

@main
struct ProcessTreeBenchmark {
  static func main() {
    // Each scope represents a pane with a root and a chain of four descendants.
    // Include snapshot construction in every scan, as the port scanner does.
    let entries = (1...2_000).map { value in
      let processID = Int32(value)
      let root = ((processID - 1) / 5) * 5 + 1
      return ProcessEntry(
        identity: TerminalAgentProcessIdentity(
          processID: processID,
          startTimeMicroseconds: UInt64(value),
        ),
        parentProcessID: processID == root ? 0 : processID - 1,
        processGroupID: root,
        name: "process",
      )
    }
    let iterations = 200
    for scopeCount in [1, 10, 50] {
      var samples: [Double] = []
      var checksum = 0
      for sample in 0..<8 {
        let start = ContinuousClock.now
        for _ in 0..<iterations {
          let snapshot = TerminalAgentProcessTreeSnapshot(entries: entries)
          for scope in 0..<scopeCount {
            checksum += snapshot.descendants(of: [entries[scope * 5].identity]).count
          }
        }
        let elapsed = start.duration(to: .now).components
        if sample > 0 {  // Discard one warm-up batch.
          samples.append(
            (Double(elapsed.seconds) * 1_000 + Double(elapsed.attoseconds) / 1e15)
              / Double(iterations)
          )
        }
      }
      precondition(checksum == 8 * iterations * scopeCount * 5)
      samples.sort()
      print(
        "processes=\(entries.count) scopes=\(scopeCount) "
          + "median_ms=\(String(format: "%.3f", samples[samples.count / 2])) "
          + "min_ms=\(String(format: "%.3f", samples[0])) "
          + "max_ms=\(String(format: "%.3f", samples[samples.count - 1]))"
      )
    }
  }
}
