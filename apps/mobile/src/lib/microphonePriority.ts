const MICROPHONE_KINDS = ["wired", "bluetooth", "builtIn", "carPlay"] as const;

type MicrophoneKind = (typeof MICROPHONE_KINDS)[number];

// A car without CarPlay connects as a Bluetooth headset, so it is a Bluetooth device.
const KIND_BY_PORT_TYPE: Readonly<Record<string, MicrophoneKind>> = {
  MicrophoneWired: "wired",
  USBAudio: "wired",
  LineIn: "wired",
  BluetoothHFP: "bluetooth",
  BluetoothLE: "bluetooth",
  MicrophoneBuiltIn: "builtIn",
  CarAudio: "carPlay",
};

/** The connected input of the first kind that has one, or null to leave the route to iOS. */
export function preferredMicrophoneInput<Input extends { readonly type: string }>(
  inputs: ReadonlyArray<Input>,
): Input | null {
  for (const kind of MICROPHONE_KINDS) {
    const input = inputs.find((candidate) => KIND_BY_PORT_TYPE[candidate.type] === kind);
    if (input) return input;
  }
  return null;
}
