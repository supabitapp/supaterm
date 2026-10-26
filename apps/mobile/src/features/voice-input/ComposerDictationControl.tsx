import type { VoiceInputPhase, VoiceInputState } from "@supaterm/client-runtime/voice-input";
import { memo, useCallback, useLayoutEffect, useState, type ReactNode } from "react";
import {
  Linking,
  Platform,
  Pressable,
  Text as SystemText,
  View,
  type LayoutChangeEvent,
} from "react-native";
import Animated, {
  Easing,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type EntryExitAnimationFunction,
  type SharedValue,
} from "react-native-reanimated";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { COMPOSER_LAYOUT_TRANSITION } from "../../components/composerLayoutTransition";
import { GlassSurface } from "../../components/ui/GlassSurface";
import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { cn } from "../../lib/cn";
import type { VoiceInputSetup } from "./useVoiceInputController";
import type { VoiceComposerPresentation } from "./voiceInputPresentation";
import { VOICE_WAVEFORM_SAMPLE_COUNT } from "./voiceInputMetering";

const DICTATION_TIMING = {
  duration: 220,
  easing: Easing.out(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const DICTATION_LAYOUT =
  Platform.OS === "android"
    ? undefined
    : LinearTransition.duration(DICTATION_TIMING.duration).reduceMotion(ReduceMotion.System);
const TOOLBAR_FLIP_TIMING = {
  duration: 260,
  easing: Easing.inOut(Easing.cubic),
  reduceMotion: ReduceMotion.System,
} as const;
const TOOLBAR_HEIGHT = 44;
const SESSION_CONTROL_HEIGHT = 56;
const SESSION_CAPSULE_STYLE = {
  borderRadius: SESSION_CONTROL_HEIGHT / 2,
  height: SESSION_CONTROL_HEIGHT,
} as const;
const TOOLBAR_PERSPECTIVE = 600;

/** Rolls a face in or out around the horizontal axis at one of its edges. */
function toolbarFlip(
  fromDegrees: number,
  toDegrees: number,
  faceHeight: number,
): EntryExitAnimationFunction {
  const halfHeight = faceHeight / 2;
  return () => {
    "worklet";
    const fromRadians = (fromDegrees * Math.PI) / 180;
    const toRadians = (toDegrees * Math.PI) / 180;
    const fromSine = Math.sin(fromRadians);
    const toSine = Math.sin(toRadians);
    return {
      initialValues: {
        opacity: fromDegrees === 0 ? 1 : 0,
        transform: [
          { perspective: TOOLBAR_PERSPECTIVE },
          { translateY: -halfHeight * fromSine },
          { rotateX: `${fromDegrees}deg` },
        ],
      },
      animations: {
        opacity: withTiming(toDegrees === 0 ? 1 : 0, TOOLBAR_FLIP_TIMING),
        transform: [
          { perspective: TOOLBAR_PERSPECTIVE },
          {
            translateY: withTiming(-halfHeight * toSine, {
              ...TOOLBAR_FLIP_TIMING,
              easing: (time) => {
                const angle =
                  fromRadians + (toRadians - fromRadians) * TOOLBAR_FLIP_TIMING.easing(time);
                return (Math.sin(angle) - fromSine) / (toSine - fromSine);
              },
            }),
          },
          { rotateX: withTiming(`${toDegrees}deg`, TOOLBAR_FLIP_TIMING) },
        ],
      },
    };
  };
}

function toolbarFace(key: "draft" | "dictation", height: number, hiddenDegrees: number) {
  return {
    key,
    height,
    entering: toolbarFlip(hiddenDegrees, 0, height),
    exiting: toolbarFlip(0, hiddenDegrees, height),
  };
}

const SESSION_TOOLBAR_FACE = toolbarFace("dictation", SESSION_CONTROL_HEIGHT, -90);
const TOOLBAR_FACES = {
  draft: toolbarFace("draft", TOOLBAR_HEIGHT, 90),
  error: toolbarFace("dictation", TOOLBAR_HEIGHT, -90),
  // Android snaps the composer to its shorter height, which would clip the
  // taller session row mid-flip.
  active: {
    ...SESSION_TOOLBAR_FACE,
    exiting: Platform.OS === "android" ? undefined : SESSION_TOOLBAR_FACE.exiting,
  },
};

/** Height of the dictation toolbar row for a voice presentation's status. */
export function composerDictationToolbarHeight(
  statusKind: VoiceComposerPresentation["statusKind"],
): number {
  return TOOLBAR_FACES[statusKind ?? "draft"].height;
}
const WAVEFORM_BAR_HEIGHT = 16;
const WAVEFORM_MIN_BAR_HEIGHT = 2;
const WAVEFORM_BAR_SPACING = 5;
const WAVEFORM_TIMING = {
  duration: 100,
  easing: Easing.out(Easing.quad),
  reduceMotion: ReduceMotion.System,
} as const;

export function ComposerDictationDraftContent(props: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly compact: boolean;
  readonly hidden: boolean;
}) {
  const rotation = useSharedValue(props.hidden ? 1 : 0);
  useLayoutEffect(() => {
    rotation.set(withTiming(props.hidden ? 1 : 0, TOOLBAR_FLIP_TIMING));
  }, [props.hidden, rotation]);
  const compact = props.compact;
  const animatedStyle = useAnimatedStyle(() => ({
    opacity: compact ? 1 - rotation.value : 1,
    transform: compact
      ? [
          { perspective: TOOLBAR_PERSPECTIVE },
          { translateY: (-TOOLBAR_HEIGHT / 2) * Math.sin((rotation.value * Math.PI) / 2) },
          { rotateX: `${rotation.value * 90}deg` },
        ]
      : [],
  }));

  return (
    <Animated.View
      accessibilityElementsHidden={props.hidden}
      importantForAccessibility={props.hidden ? "no-hide-descendants" : "auto"}
      collapsable={false}
      className={props.className}
      layout={DICTATION_LAYOUT}
      pointerEvents={props.hidden ? "none" : "auto"}
      style={[animatedStyle, { backfaceVisibility: "hidden" }]}
    >
      {props.children}
    </Animated.View>
  );
}

/**
 * Flips the entire row while keeping the outgoing controls intact until it leaves.
 * The row's clip resizes with the composer, so a taller outgoing face is not cut off.
 */
export function ComposerDictationToolbar(props: {
  readonly children: ReactNode;
  readonly statusKind: VoiceComposerPresentation["statusKind"];
  readonly visible?: boolean;
}) {
  const face = TOOLBAR_FACES[props.statusKind ?? "draft"];
  const reducedMotion = useReducedMotion();
  return (
    <Animated.View
      className="relative overflow-hidden"
      layout={COMPOSER_LAYOUT_TRANSITION}
      style={{ height: face.height }}
    >
      {props.visible !== false ? (
        <Animated.View
          key={face.key}
          className="absolute inset-0"
          entering={reducedMotion ? undefined : face.entering}
          exiting={reducedMotion ? undefined : face.exiting}
          style={{ backfaceVisibility: "hidden" }}
        >
          {props.children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const WaveformBar = memo(function WaveformBar(props: {
  readonly audioLevels: SharedValue<number[]>;
  readonly sampleIndex: number;
  readonly height?: number;
}) {
  const { audioLevels, sampleIndex } = props;
  const height = props.height ?? WAVEFORM_BAR_HEIGHT;
  const animatedStyle = useAnimatedStyle(() => {
    const level = audioLevels.get()[sampleIndex] ?? 0;
    return {
      opacity: withTiming(0.22 + level * 0.78, WAVEFORM_TIMING),
      transform: [
        {
          scaleY: withTiming(
            (WAVEFORM_MIN_BAR_HEIGHT + level * (height - WAVEFORM_MIN_BAR_HEIGHT)) / height,
            WAVEFORM_TIMING,
          ),
        },
      ],
    };
  });

  return (
    <Animated.View
      className="w-0.5 rounded-full bg-foreground"
      style={[{ height }, animatedStyle]}
    />
  );
});

const COMPACT_WAVEFORM_BAR_COUNT = 8;
const COMPACT_WAVEFORM_BAR_HEIGHT = 14;

export const CompactVoiceWaveform = memo(function CompactVoiceWaveform(props: {
  readonly audioLevels: SharedValue<number[]>;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="flex-row items-center gap-0.5"
      style={{ height: COMPACT_WAVEFORM_BAR_HEIGHT }}
    >
      {Array.from({ length: COMPACT_WAVEFORM_BAR_COUNT }, (_, index) => (
        <WaveformBar
          key={index}
          audioLevels={props.audioLevels}
          height={COMPACT_WAVEFORM_BAR_HEIGHT}
          sampleIndex={VOICE_WAVEFORM_SAMPLE_COUNT - COMPACT_WAVEFORM_BAR_COUNT + index}
        />
      ))}
    </View>
  );
});

const VoiceWaveform = memo(function VoiceWaveform(props: {
  readonly audioLevels: SharedValue<number[]>;
}) {
  const [barCount, setBarCount] = useState(0);
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setBarCount(
      Math.max(
        1,
        Math.min(
          VOICE_WAVEFORM_SAMPLE_COUNT,
          Math.floor(event.nativeEvent.layout.width / WAVEFORM_BAR_SPACING),
        ),
      ),
    );
  }, []);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="min-w-0 flex-1 flex-row items-center justify-between overflow-hidden"
      style={{ height: WAVEFORM_BAR_HEIGHT }}
      onLayout={handleLayout}
    >
      {Array.from({ length: barCount }, (_, index) => (
        <WaveformBar
          key={index}
          audioLevels={props.audioLevels}
          sampleIndex={VOICE_WAVEFORM_SAMPLE_COUNT - barCount + index}
        />
      ))}
    </View>
  );
});

/**
 * Renders the recording time in the system font: DM Sans has no tabular
 * figures, so `tabular-nums` alone would still let the width jitter.
 */
export function DictationElapsedTime(props: {
  readonly seconds: number;
  readonly className?: string;
}) {
  return (
    <SystemText
      className={cn("text-xs", props.className)}
      numberOfLines={1}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {Math.floor(props.seconds / 60)}:{String(props.seconds % 60).padStart(2, "0")}
    </SystemText>
  );
}

function SessionCapsuleButton(props: {
  readonly accessibilityLabel: string;
  readonly disabled?: boolean;
  readonly icon: AppSymbolName;
  readonly loading?: boolean;
  readonly onPress: () => void;
  readonly variant: "secondary" | "primary";
}) {
  const isPrimary = props.variant === "primary";
  const content = props.loading ? (
    <AppActivityIndicator
      size="small"
      colorClassName={isPrimary ? "accent-screen" : "accent-icon-muted"}
    />
  ) : (
    <SymbolView
      name={props.icon}
      size={22}
      weight="semibold"
      tintColorClassName={isPrimary ? "accent-screen" : "accent-icon"}
      type="monochrome"
    />
  );

  return (
    <Pressable
      accessibilityLabel={props.accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ busy: props.loading, disabled: props.disabled }}
      className={cn(
        "min-w-0 flex-1 items-center justify-center active:opacity-70",
        isPrimary && "bg-foreground",
      )}
      disabled={props.disabled}
      onPress={props.onPress}
      style={[SESSION_CAPSULE_STYLE, { opacity: props.disabled && !props.loading ? 0.4 : 1 }]}
    >
      {isPrimary ? (
        content
      ) : (
        <GlassSurface className="w-full items-center justify-center" style={SESSION_CAPSULE_STYLE}>
          {content}
        </GlassSurface>
      )}
    </Pressable>
  );
}

export function ComposerDictationStatus(props: {
  readonly audioLevels: SharedValue<number[]>;
  readonly elapsedSeconds: number;
  readonly phase: VoiceInputPhase;
  readonly presentation: VoiceComposerPresentation;
  readonly onDismissError: () => void;
}) {
  const recordingVisibility = useSharedValue(props.phase === "recording" ? 1 : 0);
  useLayoutEffect(() => {
    recordingVisibility.set(withTiming(props.phase === "recording" ? 1 : 0, DICTATION_TIMING));
  }, [props.phase, recordingVisibility]);
  const waveformStyle = useAnimatedStyle(() => ({
    opacity: recordingVisibility.get(),
  }));
  const labelStyle = useAnimatedStyle(() => ({
    opacity: 1 - recordingVisibility.get(),
  }));

  if (!props.presentation.statusLabel) return null;
  const isError = props.presentation.statusKind === "error";
  return (
    <View
      className="relative min-w-0 flex-[1.4] justify-center"
      style={{ height: composerDictationToolbarHeight(props.presentation.statusKind) }}
    >
      {isError ? (
        <View className="min-w-0 flex-row items-center gap-1.5 px-2">
          <Text className="min-w-0 flex-1 text-sm text-danger-foreground" numberOfLines={2}>
            {props.presentation.statusLabel}
          </Text>
          <Pressable
            accessibilityLabel="Dismiss voice input error"
            accessibilityRole="button"
            className="size-7 items-center justify-center active:opacity-70"
            hitSlop={8}
            onPress={props.onDismissError}
          >
            <SymbolView
              name="xmark"
              size={12}
              tintColorClassName="accent-icon-muted"
              type="monochrome"
            />
          </Pressable>
        </View>
      ) : (
        <GlassSurface
          accessible
          accessibilityLabel={props.presentation.statusLabel}
          accessibilityLiveRegion={props.phase === "recording" ? "none" : "polite"}
          style={SESSION_CAPSULE_STYLE}
        >
          <Animated.View
            className="absolute inset-0 min-w-0 flex-row items-center gap-2.5 px-4"
            style={waveformStyle}
          >
            <DictationElapsedTime
              className="text-2xl font-semibold text-foreground"
              seconds={props.elapsedSeconds}
            />
            <VoiceWaveform audioLevels={props.audioLevels} />
          </Animated.View>
          <Animated.View className="absolute inset-0 justify-center px-2" style={labelStyle}>
            <Text className="text-center text-sm text-foreground-muted" numberOfLines={1}>
              {props.presentation.statusLabel}
            </Text>
          </Animated.View>
        </GlassSurface>
      )}
    </View>
  );
}

export function ComposerDictationLeadingAction(props: {
  readonly presentation: VoiceComposerPresentation;
  readonly onStop: () => void;
  readonly onCancel: () => void;
}) {
  const action = props.presentation.leadingAction;
  if (!action) return null;
  return (
    <SessionCapsuleButton
      accessibilityLabel={action === "stop" ? "Stop dictation and review" : "Cancel dictation"}
      icon={action === "stop" ? "stop.fill" : "xmark"}
      onPress={action === "stop" ? props.onStop : props.onCancel}
      variant="secondary"
    />
  );
}

export function ComposerDictationConfirmAction(props: {
  readonly presentation: VoiceComposerPresentation;
  readonly disabled?: boolean;
  readonly onConfirm: () => void;
  readonly submitsMessage?: boolean;
}) {
  const confirmationLabel = props.submitsMessage ? "Transcribe and send" : "Finish dictation";
  return (
    <SessionCapsuleButton
      accessibilityLabel={
        props.presentation.confirmationEnabled
          ? confirmationLabel
          : (props.presentation.statusLabel ?? "Preparing voice input")
      }
      disabled={props.disabled || !props.presentation.confirmationEnabled}
      icon={props.submitsMessage ? "arrow.up" : "checkmark"}
      loading={!props.presentation.confirmationEnabled}
      onPress={props.onConfirm}
      variant="primary"
    />
  );
}

export function ComposerDictationPrimaryAction(props: {
  readonly state: VoiceInputState;
  readonly presentation: VoiceComposerPresentation;
  readonly isAvailable: boolean;
  readonly disabled?: boolean;
  readonly onStart: () => void;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  if (props.presentation.trailingAction === "confirm") {
    return <ComposerDictationConfirmAction {...props} />;
  }

  return <ComposerDictationStartAction {...props} />;
}

/**
 * The dictation button beside a composer's send or stop button. `reservesSendWidth` keeps room
 * for both while the draft is empty, so the first keystroke never shifts the toolbar.
 */
export function ComposerDictationTrailingActions(props: {
  readonly children?: ReactNode;
  readonly size?: "regular" | "large";
  readonly state: VoiceInputState;
  readonly isAvailable: boolean;
  readonly setup?: VoiceInputSetup;
  readonly disabled?: boolean;
  readonly reservesSendWidth?: boolean;
  readonly onStart: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <View
      className="shrink-0 flex-row items-center justify-end"
      style={
        props.reservesSendWidth && props.isAvailable ? { minWidth: TOOLBAR_HEIGHT * 2 } : undefined
      }
    >
      <ComposerDictationStartAction {...props} />
      {props.children}
    </View>
  );
}

function startActionLabel(openSettings: boolean, setup: VoiceInputSetup | undefined): string {
  if (openSettings) return "Open microphone settings";
  if (setup === "needs-source") return "Set up voice input";
  if (setup === "unavailable") return "Voice input unavailable";
  return "Start dictation";
}

export function ComposerDictationStartAction(props: {
  readonly size?: "regular" | "large";
  readonly state: VoiceInputState;
  readonly isAvailable: boolean;
  readonly setup?: VoiceInputSetup;
  readonly disabled?: boolean;
  readonly onStart: () => void;
  readonly onCancel: () => void;
}) {
  if (!props.isAvailable) return null;
  const openSettings = props.state.phase === "error" && props.state.errorAction === "settings";
  const unavailable = props.setup === "unavailable";
  return (
    <Pressable
      accessibilityLabel={startActionLabel(openSettings, props.setup)}
      accessibilityRole="button"
      accessibilityState={{ disabled: props.disabled }}
      className="shrink-0 items-center justify-center active:opacity-70"
      disabled={props.disabled}
      onPress={
        openSettings
          ? () => {
              props.onCancel();
              void Linking.openSettings();
            }
          : props.onStart
      }
      style={{ height: TOOLBAR_HEIGHT, opacity: props.disabled ? 0.4 : 1, width: TOOLBAR_HEIGHT }}
    >
      <SymbolView
        name={unavailable ? "mic.slash" : "mic"}
        size={props.size === "large" ? 24 : 20}
        weight="semibold"
        tintColorClassName={unavailable ? "accent-icon-muted" : "accent-icon"}
        type="monochrome"
      />
    </Pressable>
  );
}
