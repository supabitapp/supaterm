public enum CodingAgentIntegrationHealth: Equatable, Sendable {
  case unavailable
  case unavailableInstalled
  case absent
  case partial
  case drifted
  case healthy
}
