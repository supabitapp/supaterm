import Foundation
import SupatermCLIShared
import SupatermSupport
import Testing

@testable import SPCLI

struct SupatermSettingsPayloadFixtureTests {
  @Test
  func getRequestEncodesKeyOnly() throws {
    try expectFixture(SupatermSettingsGetRequest(key: "appearance.mode"), #"{"key":"appearance.mode"}"#)
    try expectRequestFixture(
      .settingsGet(SupatermSettingsGetRequest(key: "appearance.mode"), id: "get-1"),
      method: SupatermSocketMethod.appSettingsGet,
      params: #"{"key":"appearance.mode"}"#
    )
  }

  @Test
  func listRequestEncodesChangedOnly() throws {
    try expectFixture(SupatermSettingsListRequest(), #"{"changedOnly":false}"#)
    try expectFixture(SupatermSettingsListRequest(changedOnly: true), #"{"changedOnly":true}"#)
    try expectRequestFixture(
      .settingsList(SupatermSettingsListRequest(changedOnly: true), id: "list-1"),
      method: SupatermSocketMethod.appSettingsList,
      params: #"{"changedOnly":true}"#
    )
  }

  @Test
  func setRequestEncodesKeyAndValue() throws {
    try expectFixture(
      SupatermSettingsSetRequest(key: "updates.channel", value: "tip"),
      #"{"key":"updates.channel","value":"tip"}"#
    )
    try expectRequestFixture(
      .settingsSet(SupatermSettingsSetRequest(key: "updates.channel", value: "tip"), id: "set-1"),
      method: SupatermSocketMethod.appSettingsSet,
      params: #"{"key":"updates.channel","value":"tip"}"#
    )
  }

  @Test
  func resetRequestEncodesKeyOnly() throws {
    try expectFixture(SupatermSettingsResetRequest(key: "updates.channel"), #"{"key":"updates.channel"}"#)
    try expectRequestFixture(
      .settingsReset(SupatermSettingsResetRequest(key: "updates.channel"), id: "reset-1"),
      method: SupatermSocketMethod.appSettingsReset,
      params: #"{"key":"updates.channel"}"#
    )
  }

  @Test
  func entryEncodesEveryDescriptor() throws {
    try expectFixture(
      fixtureEntry,
      """
      {"allowedValues":["system","light","dark"],"defaultValue":"dark","isDefault":false,\
      "key":"appearance.mode","value":"system","valueKind":"string"}
      """
    )
  }

  @Test
  func pathResultEncodesPath() throws {
    try expectFixture(
      SupatermSettingsPathResult(path: "/tmp/settings.toml"),
      #"{"path":"\/tmp\/settings.toml"}"#
    )
  }

  @Test
  func getResultEncodesEntryPathAndWarnings() throws {
    try expectFixture(
      SupatermSettingsGetResult(
        path: "/tmp/settings.toml",
        entry: fixtureEntry,
        warnings: ["Unknown config key `obsolete`."]
      ),
      """
      {"entry":{"allowedValues":["system","light","dark"],"defaultValue":"dark","isDefault":false,\
      "key":"appearance.mode","value":"system","valueKind":"string"},"path":"\\/tmp\\/settings.toml",\
      "warnings":["Unknown config key `obsolete`."]}
      """
    )
  }

  @Test
  func listResultEncodesEntriesPathAndWarnings() throws {
    try expectFixture(
      SupatermSettingsListResult(path: "/tmp/settings.toml", entries: [fixtureEntry]),
      """
      {"entries":[{"allowedValues":["system","light","dark"],"defaultValue":"dark","isDefault":false,\
      "key":"appearance.mode","value":"system","valueKind":"string"}],"path":"\\/tmp\\/settings.toml",\
      "warnings":[]}
      """
    )
  }

  @Test
  func mutationResultEncodesOldAndNewValues() throws {
    try expectFixture(
      SupatermSettingsMutationResult(
        path: "/tmp/settings.toml",
        key: "updates.channel",
        oldValue: "stable",
        value: "tip",
        defaultValue: "stable",
        isDefault: false,
        warnings: ["Update channel changes apply next time Supaterm starts."]
      ),
      """
      {"defaultValue":"stable","isDefault":false,"key":"updates.channel","oldValue":"stable",\
      "path":"\\/tmp\\/settings.toml","value":"tip",\
      "warnings":["Update channel changes apply next time Supaterm starts."]}
      """
    )
  }

  @Test
  func validationResultEncodesStatusWarningsAndErrors() throws {
    try expectFixture(
      SupatermSettingsValidationResult(
        path: "/tmp/settings.toml",
        status: .invalid,
        warnings: ["Unknown config key `obsolete`."],
        errors: ["The data couldn't be read because it isn't in the correct format."]
      ),
      """
      {"errors":["The data couldn't be read because it isn't in the correct format."],\
      "path":"\\/tmp\\/settings.toml","status":"invalid","warnings":["Unknown config key `obsolete`."]}
      """
    )
  }

  @Test
  func everySettingsKeyEncodesItsRegistryEntry() throws {
    try expectFixture(
      SupatermSettingsRegistry.list(settings: .default, path: "/tmp/settings.toml", changedOnly: false)
        .entries
        .map(\.key),
      """
      ["appearance.mode","terminal.restore_layout","terminal.zmx_sessions_enabled",\
      "notifications.system_notifications","notifications.glowing_pane_ring",\
      "coding_agents.show_panel","privacy.analytics_enabled",\
      "privacy.crash_reports_enabled","updates.channel","logging.verbose_enabled"]
      """
    )
  }
}

private let fixtureEntry = SupatermSettingsEntry(
  key: "appearance.mode",
  value: "system",
  defaultValue: "dark",
  valueKind: .string,
  allowedValues: ["system", "light", "dark"],
  isDefault: false
)

private func expectFixture<T: Codable & Equatable>(
  _ value: T,
  _ json: String,
  sourceLocation: SourceLocation = #_sourceLocation
) throws {
  let encoded = try jsonString(value)
  #expect(encoded == json, sourceLocation: sourceLocation)
  #expect(
    try JSONDecoder().decode(T.self, from: Data(encoded.utf8)) == value,
    sourceLocation: sourceLocation
  )
}

private func expectRequestFixture(
  _ request: @autoclosure () throws -> SupatermSocketRequest,
  method: String,
  params: String,
  sourceLocation: SourceLocation = #_sourceLocation
) throws {
  let request = try request()
  #expect(request.method == method, sourceLocation: sourceLocation)
  #expect(try jsonString(request.params) == params, sourceLocation: sourceLocation)
  #expect(
    try JSONDecoder().decode(SupatermSocketRequest.self, from: Data(try jsonString(request).utf8))
      == request,
    sourceLocation: sourceLocation
  )
}
