import Foundation
import IOKit

nonisolated func hardwareUUID() -> String? {
  let platformExpert = IOServiceGetMatchingService(
    kIOMainPortDefault,
    IOServiceMatching("IOPlatformExpertDevice")
  )

  guard platformExpert != 0 else { return nil }
  defer { IOObjectRelease(platformExpert) }

  let uuid = IORegistryEntryCreateCFProperty(
    platformExpert,
    kIOPlatformUUIDKey as CFString,
    kCFAllocatorDefault,
    0
  )

  return uuid?.takeRetainedValue() as? String
}
