package expo.modules.supatermrelaytunnel.core

import kotlin.test.assertEquals
import kotlin.test.assertNull
import org.junit.Test

class TunnelRaceTest {
  @Test
  fun directCandidatesKeepOnlyPlainWebSocketBaseUrls() {
    val urls = directTunnelUrls(
      listOf(
        "ws://192.168.1.20:3773",
        "wss://host.tailnet.ts.net/base",
        "http://192.168.1.20:3773",
        "ws://user:secret@192.168.1.20:3773",
        "ws://192.168.1.20:3773/?token=1",
        "ws://192.168.1.20:3773/#x",
        "ws://",
        "not a url",
      )
    )
    assertEquals(listOf("ws://192.168.1.20:3773", "wss://host.tailnet.ts.net/base"), urls)
  }

  @Test
  fun directCandidatesAreDeduplicatedAndCappedAtEight() {
    val urls =
      directTunnelUrls(listOf("ws://10.0.0.1:3773") + (1..12).map { "ws://10.0.0.$it:3773" })
    assertEquals((1..8).map { "ws://10.0.0.$it:3773" }, urls)
  }

  @Test
  fun firstWelcomeWinsAndCancelsTheOthers() {
    val race = TunnelRace<String>(
      mapOf(0 to TunnelRoute.RELAY, 1 to TunnelRoute.DIRECT, 2 to TunnelRoute.DIRECT)
    )
    assertNull(race.fail(1, "refused"))
    assertEquals(listOf(0), race.welcome(2))
    assertEquals(2, race.winner)
  }

  @Test
  fun welcomeAfterTheWinnerIsRefused() {
    val race = TunnelRace<String>(mapOf(0 to TunnelRoute.RELAY, 1 to TunnelRoute.DIRECT))
    assertEquals(listOf(1), race.welcome(0))
    assertNull(race.welcome(1))
    assertNull(race.fail(1, "late"))
    assertEquals(0, race.winner)
  }

  @Test
  fun failedCandidateCannotWinLater() {
    val race = TunnelRace<String>(mapOf(0 to TunnelRoute.RELAY, 1 to TunnelRoute.DIRECT))
    assertNull(race.fail(1, "identity mismatch"))
    assertNull(race.welcome(1))
    assertEquals(emptyList(), race.welcome(0))
  }

  @Test
  fun raceFailsOnlyOnceEveryCandidateFailedAndKeepsTheRelayReason() {
    val race = TunnelRace<String>(
      mapOf(0 to TunnelRoute.RELAY, 1 to TunnelRoute.DIRECT, 2 to TunnelRoute.DIRECT)
    )
    assertNull(race.fail(0, "host-offline"))
    assertNull(race.fail(2, "refused"))
    assertEquals("host-offline", race.fail(1, "timeout"))
    assertNull(race.winner)
  }
}
