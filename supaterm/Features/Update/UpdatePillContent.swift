enum UpdatePillStyle: Equatable, Sendable {
  case capsule
  case circle
}

struct UpdatePillContent: Equatable, Sendable {
  let allowsPopover: Bool
  let badge: UpdateBadge?
  let helpText: String
  let maxText: String
  let style: UpdatePillStyle
  let text: String
  let tone: UpdatePillTone

  init?(
    phase: UpdatePhase,
    isDevelopmentBuild: Bool,
    isHovering: Bool
  ) {
    if phase.isIdle {
      guard isDevelopmentBuild else { return nil }
      self = .developmentBuild(isHovered: isHovering)
      return
    }

    if case .checking = phase {
      self = .compactStatus(phase: phase)
      return
    }

    if case .notFound = phase {
      return nil
    }

    if case .installing = phase {
      self = .installingStatus(phase: phase, isHovered: isHovering)
      return
    }

    self.init(
      allowsPopover: phase.allowsPopover,
      badge: phase.badge,
      helpText: phase.text,
      maxText: phase.maxText,
      style: .capsule,
      text: phase.text,
      tone: phase.pillTone
    )
  }

  private init(
    allowsPopover: Bool,
    badge: UpdateBadge?,
    helpText: String,
    maxText: String,
    style: UpdatePillStyle,
    text: String,
    tone: UpdatePillTone
  ) {
    self.allowsPopover = allowsPopover
    self.badge = badge
    self.helpText = helpText
    self.maxText = maxText
    self.style = style
    self.text = text
    self.tone = tone
  }

  private static func developmentBuild(isHovered: Bool) -> Self {
    Self(
      allowsPopover: false,
      badge: nil,
      helpText: AppBuild.developmentBuildMessage,
      maxText: AppBuild.developmentBuildMessage,
      style: isHovered ? .capsule : .circle,
      text: isHovered ? AppBuild.developmentBuildMessage : "",
      tone: .accent
    )
  }

  private static func compactStatus(phase: UpdatePhase) -> Self {
    Self(
      allowsPopover: false,
      badge: phase.badge,
      helpText: phase.text,
      maxText: "",
      style: .circle,
      text: "",
      tone: phase.pillTone
    )
  }

  private static func installingStatus(phase: UpdatePhase, isHovered: Bool) -> Self {
    guard !isHovered else {
      return Self(
        allowsPopover: phase.allowsPopover,
        badge: phase.badge,
        helpText: phase.text,
        maxText: phase.maxText,
        style: .capsule,
        text: phase.text,
        tone: phase.pillTone
      )
    }

    return Self(
      allowsPopover: phase.allowsPopover,
      badge: phase.badge,
      helpText: phase.text,
      maxText: phase.maxText,
      style: .circle,
      text: "",
      tone: phase.pillTone
    )
  }
}
