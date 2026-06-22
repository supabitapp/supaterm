import SwiftUI

enum TerminalMotion {
  static func allowsMotion(reduceMotion: Bool) -> Bool {
    !reduceMotion
  }

  static func animation(_ animation: Animation, reduceMotion: Bool) -> Animation? {
    allowsMotion(reduceMotion: reduceMotion) ? animation : nil
  }

  static func transition(_ transition: AnyTransition, reduceMotion: Bool) -> AnyTransition {
    allowsMotion(reduceMotion: reduceMotion) ? transition : .identity
  }

  static func animate(
    _ animation: Animation,
    reduceMotion: Bool,
    _ body: () -> Void
  ) {
    guard allowsMotion(reduceMotion: reduceMotion) else {
      var transaction = Transaction(animation: nil)
      transaction.disablesAnimations = true
      withTransaction(transaction) {
        body()
      }
      return
    }
    withAnimation(animation) {
      body()
    }
  }
}

extension View {
  func terminalAnimation<Value: Equatable>(
    _ animation: Animation,
    value: Value,
    reduceMotion: Bool
  ) -> some View {
    self.animation(
      TerminalMotion.animation(animation, reduceMotion: reduceMotion),
      value: value
    )
  }

  func terminalTransition(
    _ transition: AnyTransition,
    reduceMotion: Bool
  ) -> some View {
    self.transition(TerminalMotion.transition(transition, reduceMotion: reduceMotion))
  }

}
