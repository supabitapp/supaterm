import type { VoiceMicrophone } from "@supaterm/contracts/settings";

export interface MicrophoneInput {
  readonly deviceId: string;
  readonly label: string;
}

export interface MicrophonePreference {
  readonly chosen: VoiceMicrophone | null;
  readonly avoidBluetooth: boolean;
}

export interface MicrophoneRoute {
  /** The input to open, or null for the browser's default. */
  readonly deviceId: string | null;
  /** The input voice input records from, when the browser names its inputs. */
  readonly input: MicrophoneInput | null;
  /** The chosen microphone isn't connected, so the system default stands in. */
  readonly chosenMissing: boolean;
  /** The Bluetooth system default that `input` stands in for. */
  readonly passedOver: MicrophoneInput | null;
}

const VOICE_PROCESSING = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

// Chromium lists these aliases of real inputs; other browsers list the default first.
const ALIAS_IDS = new Set(["default", "communications"]);
// Chromium on macOS ends each label with the input's transport type.
const BLUETOOTH = / \(Bluetooth(?: LE)?\)$/;
const BUILT_IN = / \(Built-in\)$/;
const NEVER_STANDS_IN = / \((?:Virtual|Aggregate|AutoAggregate)\)$/;

const UNAVAILABLE_INPUT_ERRORS = new Set([
  "OverconstrainedError",
  "NotFoundError",
  "NotReadableError",
]);

/** Browsers hide device labels until microphone access is granted. */
export function labelsHidden(inputs: ReadonlyArray<MicrophoneInput>) {
  return inputs.every((input) => input.label === "");
}

export function namedMicrophones(inputs: ReadonlyArray<MicrophoneInput>) {
  return inputs.filter((input) => !ALIAS_IDS.has(input.deviceId));
}

/** Whether the labels show which inputs are Bluetooth, so passing over one can work. */
export function labelsShowTransport(inputs: ReadonlyArray<MicrophoneInput>) {
  return inputs.some((input) => BLUETOOTH.test(input.label) || BUILT_IN.test(input.label));
}

function systemDefault(inputs: ReadonlyArray<MicrophoneInput>): MicrophoneInput | null {
  const first = inputs[0];
  if (!first) return null;
  if (!ALIAS_IDS.has(first.deviceId)) return first;
  const aliased = namedMicrophones(inputs)
    .filter((input) => first.label.endsWith(input.label))
    .toSorted((left, right) => right.label.length - left.label.length);
  return aliased[0] ?? first;
}

/**
 * The chosen microphone while it is listed, else the system default. With `avoidBluetooth`, a
 * Bluetooth default is passed over for the built-in microphone, else another real input, so a
 * headset keeps its audio quality. A chosen microphone is never passed over.
 */
export function resolveMicrophone(
  inputs: ReadonlyArray<MicrophoneInput>,
  preference: MicrophonePreference,
): MicrophoneRoute {
  const { chosen } = preference;
  if (labelsHidden(inputs)) {
    return {
      deviceId: chosen?.deviceId ?? null,
      input: null,
      chosenMissing: false,
      passedOver: null,
    };
  }
  const microphones = namedMicrophones(inputs);
  const match =
    chosen &&
    (microphones.find((input) => input.deviceId === chosen.deviceId) ??
      microphones.find((input) => input.label === chosen.label));
  if (match)
    return { deviceId: match.deviceId, input: match, chosenMissing: false, passedOver: null };
  const chosenMissing = chosen !== null;
  const fallback = systemDefault(inputs);
  if (preference.avoidBluetooth && fallback && BLUETOOTH.test(fallback.label)) {
    const usable = microphones.filter(
      (input) => !BLUETOOTH.test(input.label) && !NEVER_STANDS_IN.test(input.label),
    );
    const standIn = usable.find((input) => BUILT_IN.test(input.label)) ?? usable[0];
    if (standIn) {
      return { deviceId: standIn.deviceId, input: standIn, chosenMissing, passedOver: fallback };
    }
  }
  return { deviceId: null, input: fallback, chosenMissing, passedOver: null };
}

export async function listMicrophoneInputs(): Promise<ReadonlyArray<MicrophoneInput>> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audioinput")
    .map(({ deviceId, label }) => ({ deviceId, label }));
}

function errorName(error: unknown): string {
  return error instanceof Object && "name" in error && typeof error.name === "string"
    ? error.name
    : "";
}

function openInput(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio:
      deviceId === null ? VOICE_PROCESSING : { ...VOICE_PROCESSING, deviceId: { exact: deviceId } },
  });
}

/** An input that won't open is left out and the rest resolved again, ending at the default. */
async function openResolved(
  inputs: ReadonlyArray<MicrophoneInput>,
  preference: MicrophonePreference,
): Promise<MediaStream> {
  const { deviceId } = resolveMicrophone(inputs, preference);
  try {
    return await openInput(deviceId);
  } catch (error) {
    if (deviceId === null || !UNAVAILABLE_INPUT_ERRORS.has(errorName(error))) throw error;
    const rest = inputs.filter((input) => input.deviceId !== deviceId);
    return openResolved(rest, { ...preference, chosen: null });
  }
}

export async function openMicrophone(preference: MicrophonePreference): Promise<MediaStream> {
  const inputs = await listMicrophoneInputs();
  const stream = await openResolved(inputs, preference);
  if (!labelsHidden(inputs)) return stream;
  const exposed = await listMicrophoneInputs();
  const { deviceId } = resolveMicrophone(exposed, preference);
  const opened = stream.getAudioTracks()[0]?.getSettings().deviceId;
  if (deviceId === null || deviceId === opened) return stream;
  for (const track of stream.getTracks()) track.stop();
  return openResolved(exposed, preference);
}
