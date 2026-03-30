import Foundation
import Testing

@testable import supaterm

struct UpdateSettingsTests {
  @Test
  func stableChannelUsesDefaultSparkleFeedRules() {
    #expect(UpdateChannel.stable.sparkleChannels.isEmpty)
    #expect(UpdateChannel.stable.updateCheckInterval == 3600)
  }

  @Test
  func tipChannelUsesTipSparkleFeedRules() {
    #expect(UpdateChannel.tip.sparkleChannels == ["tip"])
    #expect(UpdateChannel.tip.updateCheckInterval == 900)
  }

  @Test
  func automaticDownloadsRequireAutomaticChecks() {
    let settings = UpdateSettings(
      updateChannel: .tip,
      automaticallyChecksForUpdates: false,
      automaticallyDownloadsUpdates: true
    )

    #expect(!settings.automaticallyChecksForUpdates)
    #expect(!settings.automaticallyDownloadsUpdates)
  }
}
