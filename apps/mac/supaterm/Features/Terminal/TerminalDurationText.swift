import Foundation

nonisolated func terminalCompactDurationText(from start: Date, to end: Date) -> String {
  let elapsed = end.timeIntervalSince(start)
  let seconds = elapsed.isFinite ? max(0, Int(elapsed.rounded(.down))) : 0
  if seconds < 60 {
    return "\(seconds)s"
  }
  let minutes = seconds / 60
  if minutes < 60 {
    return "\(minutes)m"
  }
  let hours = minutes / 60
  let remainingMinutes = minutes % 60
  if remainingMinutes == 0 {
    return "\(hours)h"
  }
  return "\(hours)h \(remainingMinutes)m"
}
