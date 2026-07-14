import Testing

@testable import supaterm

struct ReleaseAnnouncementTests {
  @Test
  func calendarVersionComparesNumericComponents() throws {
    let lower = try #require(ReleaseAnnouncementVersion("1.3.2"))
    let higher = try #require(ReleaseAnnouncementVersion("1.3.10"))

    #expect(higher > lower)
  }

  @Test
  func calendarVersionSortsAfterHistoricalVersion() throws {
    let historical = try #require(ReleaseAnnouncementVersion("1.3.7"))
    let current = try #require(ReleaseAnnouncementVersion("26.0.0"))

    #expect(current > historical)
  }

  @Test
  func calendarReleaseAndPatchCompareNumerically() throws {
    let base = try #require(ReleaseAnnouncementVersion("26.0.9"))
    let regular = try #require(ReleaseAnnouncementVersion("26.1.0"))
    let hotfix = try #require(ReleaseAnnouncementVersion("26.1.1"))

    #expect(regular > base)
    #expect(hotfix > regular)
  }

  @Test
  func equalVersionDoesNotShowAnnouncement() throws {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "1.3.4",
      storageState: ReleaseAnnouncementStorageState(
        acknowledgedVersion: "1.3.4"
      ),
      hasExistingSupatermState: true
    )

    #expect(result.announcement == nil)
    #expect(result.storageState.acknowledgedVersion == "1.3.4")
  }

  @Test
  func malformedCurrentVersionHidesAnnouncement() {
    let stored = ReleaseAnnouncementStorageState(
      acknowledgedVersion: "1.3.2"
    )
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "",
      storageState: stored,
      hasExistingSupatermState: true
    )

    #expect(result.announcement == nil)
    #expect(result.storageState == stored)
  }

  @Test
  func freshInstallSeedsCurrentVersionAndShowsNoHistoricalAnnouncement() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "1.3.4",
      storageState: nil,
      hasExistingSupatermState: false
    )

    #expect(result.announcement == nil)
    #expect(result.storageState.acknowledgedVersion == "1.3.4")
  }

  @Test
  func existingInstallWithoutAnnouncementStateShowsCurrentCard() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "1.3.4",
      storageState: nil,
      hasExistingSupatermState: true
    )

    #expect(result.announcement == .agentForking)
    #expect(result.storageState.acknowledgedVersion == "1.3.2")
  }

  @Test
  func upgradeFromOlderAcknowledgedVersionShowsEligibleCard() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "1.3.4",
      storageState: ReleaseAnnouncementStorageState(
        acknowledgedVersion: "1.3.2"
      ),
      hasExistingSupatermState: true
    )

    #expect(result.announcement == .agentForking)
    #expect(result.storageState.acknowledgedVersion == "1.3.2")
  }

  @Test
  func newestUnacknowledgedAnnouncementTakesPriority() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "26.3.0",
      storageState: ReleaseAnnouncementStorageState(acknowledgedVersion: "1.3.2"),
      hasExistingSupatermState: true
    )

    #expect(result.announcement == .finalBeta)
    #expect(result.storageState.acknowledgedVersion == "1.3.2")
  }

  @Test
  func upgradeFromPreviousCalVerShowsColorTuningCard() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "26.1.0",
      storageState: ReleaseAnnouncementStorageState(
        acknowledgedVersion: "26.0.0"
      ),
      hasExistingSupatermState: true
    )

    #expect(result.announcement == .colorTuning)
    #expect(result.storageState.acknowledgedVersion == "26.0.0")
  }

  @Test
  func upgradeFromPreviousReleaseShowsFinalBetaCard() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "26.3.0",
      storageState: ReleaseAnnouncementStorageState(
        acknowledgedVersion: "26.2.0"
      ),
      hasExistingSupatermState: true
    )

    #expect(result.announcement == .finalBeta)
    #expect(result.storageState.acknowledgedVersion == "26.2.0")
  }

  @Test
  func finalBetaCardSurvivesRelaunch() {
    let firstLaunch = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "26.3.0",
      storageState: ReleaseAnnouncementStorageState(acknowledgedVersion: "26.2.0"),
      hasExistingSupatermState: true
    )
    let secondLaunch = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "26.3.0",
      storageState: firstLaunch.storageState,
      hasExistingSupatermState: true
    )

    #expect(firstLaunch.announcement == .finalBeta)
    #expect(secondLaunch.announcement == .finalBeta)
    #expect(secondLaunch.storageState.acknowledgedVersion == "26.2.0")
  }

  @Test
  func finalBetaCardSurvivesHotfixUpgrade() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "26.3.1",
      storageState: ReleaseAnnouncementStorageState(acknowledgedVersion: "26.2.0"),
      hasExistingSupatermState: true
    )

    #expect(result.announcement == .finalBeta)
    #expect(result.storageState.acknowledgedVersion == "26.2.0")
  }

  @Test
  func acknowledgedFinalBetaCardStaysHiddenAfterHotfixUpgrade() {
    let result = ReleaseAnnouncementCatalog.synchronize(
      currentVersion: "26.3.1",
      storageState: ReleaseAnnouncementStorageState(acknowledgedVersion: "26.3.0"),
      hasExistingSupatermState: true
    )

    #expect(result.announcement == nil)
    #expect(result.storageState.acknowledgedVersion == "26.3.0")
  }

  @Test
  func agentForkingCopyMatchesReleaseCard() {
    let expectedMessage =
      "Forking session is now easier than ever using the agent panel. "
      + "Enable coding agents integration to try it."

    #expect(ReleaseAnnouncement.agentForking.title == "Fork sessions from the agent panel")
    #expect(
      ReleaseAnnouncement.agentForking.message
        == expectedMessage
    )
    #expect(ReleaseAnnouncement.agentForking.footer == "Settings → Coding Agents")
    #expect(ReleaseAnnouncement.agentForking.icon == .asset("git-fork"))
  }

  @Test
  func colorTuningCopyMatchesReleaseCard() {
    #expect(ReleaseAnnouncement.colorTuning.title == "🎨 Color Tuning")
    #expect(
      ReleaseAnnouncement.colorTuning.message
        == "The sidebar now reads cleaner in light and dark mode."
    )
    #expect(ReleaseAnnouncement.colorTuning.footer == "Supaterm v26.1.0")
    #expect(ReleaseAnnouncement.colorTuning.icon == .asset("AppearanceAuto"))
  }
}
