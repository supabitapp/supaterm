struct UpdateCheckPreflight<Check: Equatable> {
  enum Decision: Equatable {
    case allow
    case deny
    case startRefresh
  }

  private struct Pending {
    let check: Check
    var cycleFinished = false
    var refreshFinished = false
  }

  private var pending: Pending?
  private var prepared: Check?

  mutating func prepare(_ check: Check) {
    prepared = check
  }

  mutating func request(_ check: Check) -> Decision {
    if prepared == check {
      prepared = nil
      return .allow
    }
    guard pending == nil else { return .deny }
    pending = Pending(check: check)
    return .startRefresh
  }

  mutating func cycleDidFinish(_ check: Check) -> Check? {
    guard pending?.check == check else { return nil }
    pending?.cycleFinished = true
    return resumeIfReady()
  }

  mutating func refreshDidFinish() -> Check? {
    pending?.refreshFinished = true
    return resumeIfReady()
  }

  private mutating func resumeIfReady() -> Check? {
    guard
      let pending,
      pending.cycleFinished,
      pending.refreshFinished
    else { return nil }
    self.pending = nil
    return pending.check
  }
}
