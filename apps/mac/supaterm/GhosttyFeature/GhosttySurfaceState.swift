import GhosttyKit
import Observation

@MainActor
@Observable
public final class GhosttySurfaceState {
  public var title: String?
  public var titleOverride: String?
  public var pwd: String?
  public var progressStyleEnabled = true
  public var progressState: ghostty_action_progress_report_state_e?
  public var progressValue: Int?
  public var commandExitCode: Int?
  public var commandDuration: UInt64?
  public var childExitCode: UInt32?
  public var childExitTimeMs: UInt64?
  public var readOnly: ghostty_action_readonly_e?
  public var mouseShape: ghostty_action_mouse_shape_e?
  public var mouseVisibility: ghostty_action_mouse_visibility_e?
  public var mouseOverLink: String?
  public var rendererHealth: ghostty_action_renderer_health_e?
  public var openUrl: String?
  public var openUrlKind: ghostty_action_open_url_kind_e?
  public var colorChangeKind: ghostty_action_color_kind_e?
  public var colorChangeR: UInt8?
  public var colorChangeG: UInt8?
  public var colorChangeB: UInt8?
  public var searchNeedle: String?
  public var searchTotal: Int?
  public var searchSelected: Int?
  public var searchFocusCount = 0
  public var sizeLimitMinWidth: UInt32?
  public var sizeLimitMinHeight: UInt32?
  public var sizeLimitMaxWidth: UInt32?
  public var sizeLimitMaxHeight: UInt32?
  public var initialSizeWidth: UInt32?
  public var initialSizeHeight: UInt32?
  public var keySequenceActive: Bool?
  public var keySequenceTrigger: ghostty_input_trigger_s?
  public var keyTableTag: ghostty_action_key_table_tag_e?
  public var keyTableName: String?
  public var keyTableDepth: Int = 0
  public var secureInput: ghostty_action_secure_input_e?
  public var floatWindow: ghostty_action_float_window_e?
  public var reloadConfigSoft: Bool?
  public var configChangeCount: Int = 0
  public var bellCount: Int = 0
  public var presentTerminalCount: Int = 0
  public var resetWindowSizeCount: Int = 0
  public var quitTimer: ghostty_action_quit_timer_e?

  public var effectiveTitle: String? {
    if let titleOverride {
      return titleOverride
    }
    guard let title, !title.isEmpty else { return nil }
    return title
  }
}
