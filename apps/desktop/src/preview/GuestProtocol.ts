export const START_PICK_CHANNEL = "preview:start-pick";
export const CANCEL_PICK_CHANNEL = "preview:cancel-pick";
export const ELEMENT_PICKED_CHANNEL = "preview:element-picked";
export const ANNOTATION_CAPTURED_CHANNEL = "preview:annotation-captured";
export const ANNOTATION_THEME_CHANNEL = "preview:annotation-theme";
export const ANNOTATION_SEND_ENABLED_CHANNEL = "preview:annotation-send-enabled";
export const HUMAN_INPUT_CHANNEL = "preview:human-input";
export const MOUSE_NAVIGATE_CHANNEL = "preview:mouse-navigate";
// Sent to the hosting <webview> element (ipc-message). The web app mirrors this
// literal in HostedBrowserWebview because it cannot import from the desktop app.
export const POINTER_DOWN_HOST_CHANNEL = "preview:pointer-down";
export const PAGE_UNHANDLED_SHORTCUT_CHANNEL = "preview:page-unhandled-shortcut";
export const RECORDING_CURSOR_CHANNEL = "preview:recording-cursor";
export const RECORDING_POINTER_CHANNEL = "preview:recording-pointer";
export const RECORDING_INPUT_CHANNEL = "preview:recording-input";
export const RECORDING_CONTROLLER_CHANNEL = "preview:recording-controller";
export const PRIMARY_PASTE_DISABLED_ARGUMENT = "--supaterm-preview-primary-paste-disabled";
