import SupatermSupport

struct UpdateRelease<Value> {
  let value: Value
  let version: String
  let displayVersion: String
  let releaseDay: LicenseDay?
  let channel: String?

  init(
    value: Value,
    version: String,
    displayVersion: String? = nil,
    releaseDay: LicenseDay?,
    channel: String?
  ) {
    self.value = value
    self.version = version
    self.displayVersion = displayVersion ?? version
    self.releaseDay = releaseDay
    self.channel = channel
  }
}

enum UpdateSelection<Value> {
  case none
  case release(Value)
  case unfiltered
}

extension UpdateSelection: Equatable where Value: Equatable {}
