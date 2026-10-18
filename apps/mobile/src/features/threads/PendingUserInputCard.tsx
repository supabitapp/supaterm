import { RequestActionButton } from "./RequestActionButton";
import { QuestionAttachments } from "./QuestionAttachments";
import * as Haptics from "expo-haptics";
import type { RuntimeRequestId } from "@supaterm/contracts";
import type { ThreadUserInputQuestion } from "@supaterm/client-runtime/state/thread-requests";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  FadeInUp,
  FadeOutDown,
  LayoutAnimationConfig,
  LinearTransition,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type EntryAnimationsValues,
  type ExitAnimationsValues,
  type LayoutAnimation,
  type SharedValue,
} from "react-native-reanimated";

import { USER_INPUT_TOGGLE_DURATION_MS } from "./pendingUserInputLayout";
import { QuestionAutoDismissToggle } from "./QuestionAutoDismissTimer";

import { SymbolView } from "../../components/ui/AppSymbol";
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { cn } from "../../lib/cn";
import { playDecisionHaptic } from "../../lib/decisionHaptic";
import { SYSTEM_FONT_FAMILY } from "../../lib/fonts";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText";
import { useOpenPullRequest } from "../../native/useOpenPullRequest";
import { useMarkdownPreviewStyles } from "../files/FileMarkdownPreview";
import {
  isPendingUserInputOptionSelected,
  isPendingUserInputQuestionAnswered,
  resumePendingUserInputQuestionIndex,
  type PendingUserInput,
  type PendingUserInputDraftAnswer,
} from "../../lib/threadActivity";

export interface PendingUserInputCardProps {
  readonly canOperateThread: boolean;
  readonly pendingUserInput: PendingUserInput;
  readonly maxHeight: number;
  readonly collapsed: boolean;
  readonly onToggleCollapsed: () => void;
  readonly onStopThread?: () => void;
  readonly cardProgress?: SharedValue<number>;
  readonly cardCoverage?: SharedValue<number>;
  readonly onInputFocusChange?: (focused: boolean) => void;
  readonly drafts: Record<string, PendingUserInputDraftAnswer>;
  readonly answers: Record<string, string | ReadonlyArray<string>> | null;
  readonly respondingUserInputId: RuntimeRequestId | null;
  readonly onSelectOption: (
    requestId: RuntimeRequestId,
    question: ThreadUserInputQuestion,
    value: string,
  ) => void;
  readonly onChangeCustomAnswer: (
    requestId: RuntimeRequestId,
    questionId: string,
    customAnswer: string,
  ) => void;
  readonly onSubmit: () => Promise<unknown>;
  readonly onDismiss: () => Promise<unknown>;
  readonly supportsQuestionAutoDismiss?: boolean;
}

/**
 * Android cannot use the overlay: it does not hit-test touches outside a
 * parent's bounds, which made everything above the bar-sized wrapper
 * untouchable.
 */
const EXPANDED_CARD_IS_OVERLAY = Platform.OS === "ios";

const CARD_LAYOUT_TRANSITION = LinearTransition.duration(200);

/** Long enough to see the picked option highlight before the next question replaces it. */
const SINGLE_SELECT_ADVANCE_DELAY_MS = 200;

const FALLBACK_TITLE = "Fill in the pending answers";

/**
 * Both pages travel the window width on one curve, so they move as a unit and
 * sit side by side instead of overlapping; the card clips whatever is outside it.
 */
const QUESTION_PUSH_TIMING = {
  duration: 300,
  easing: Easing.bezier(0.32, 0.72, 0, 1),
  reduceMotion: ReduceMotion.System,
};

/**
 * Keyed by question so paging pushes the old question out and the new one in.
 * The config skips both when the card itself mounts or unmounts, so only a
 * page change animates.
 */
function QuestionPage(props: {
  readonly questionId: string | undefined;
  /** 1 when paging forward (pages move left), -1 when paging back. */
  readonly direction: SharedValue<number>;
  readonly className?: string;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}) {
  const { direction } = props;
  // The worklets read the direction when they run, because the outgoing page
  // keeps the exiting prop it last rendered with.
  const pushIn = useCallback(
    (values: EntryAnimationsValues): LayoutAnimation => {
      "worklet";
      return {
        initialValues: { transform: [{ translateX: values.windowWidth * direction.get() }] },
        animations: { transform: [{ translateX: withTiming(0, QUESTION_PUSH_TIMING) }] },
      };
    },
    [direction],
  );
  const pushOut = useCallback(
    (values: ExitAnimationsValues): LayoutAnimation => {
      "worklet";
      return {
        initialValues: { transform: [{ translateX: 0 }] },
        animations: {
          transform: [
            { translateX: withTiming(-values.windowWidth * direction.get(), QUESTION_PUSH_TIMING) },
          ],
        },
      };
    },
    [direction],
  );
  return (
    <LayoutAnimationConfig skipEntering skipExiting>
      <Animated.View
        key={props.questionId}
        entering={pushIn}
        exiting={pushOut}
        className={props.className}
        style={props.style}
      >
        {props.children}
      </Animated.View>
    </LayoutAnimationConfig>
  );
}

function QuestionText(props: { readonly markdown: string }) {
  const styles = useMarkdownPreviewStyles();
  const openLink = useOpenPullRequest();
  const textStyle = useMemo(
    () => ({ ...styles.nativeTextStyle, fontFamily: SYSTEM_FONT_FAMILY, fontWeight: "500" }),
    [styles.nativeTextStyle],
  );
  return (
    <SelectableMarkdownText
      markdown={props.markdown}
      textStyle={textStyle}
      onLinkPress={(href) => void openLink(href)}
    />
  );
}

export function PendingUserInputCard(props: PendingUserInputCardProps) {
  const { requestId, questions } = props.pendingUserInput;
  const questionCount = questions.length;
  const canRespond = props.pendingUserInput.responseCapability !== "not_resumable";
  const isResponding = props.respondingUserInputId === requestId;
  const responseDisabled = !canRespond || isResponding;

  // One question per page, like the desktop composer. Drafts outlive the card,
  // so a reopened request resumes at its first unanswered question.
  const [page, setPage] = useState(() => ({
    requestId,
    index: resumePendingUserInputQuestionIndex(questions, props.drafts),
  }));
  if (page.requestId !== requestId) {
    setPage({ requestId, index: resumePendingUserInputQuestionIndex(questions, props.drafts) });
  }
  const questionIndex = Math.min(page.index, Math.max(questionCount - 1, 0));
  const question = questions[questionIndex];
  const activeDraft = question ? props.drafts[question.id] : undefined;
  const isLastQuestion = questionIndex >= questionCount - 1;
  const questionAnswered =
    question !== undefined && isPendingUserInputQuestionAnswered(question, activeDraft);
  const attachmentsPreparing = activeDraft?.attachmentsPreparing === true;
  const canSubmit = props.canOperateThread && !responseDisabled && props.answers !== null;

  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelAutoAdvance = useCallback(() => {
    if (advanceTimerRef.current !== null) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);
  useEffect(() => cancelAutoAdvance, [cancelAutoAdvance]);
  const pushDirection = useSharedValue(1);
  const describeQuestion = (index: number) => {
    const header = questions[index]?.header ?? FALLBACK_TITLE;
    return questionCount > 1 ? `${header}, question ${index + 1} of ${questionCount}` : header;
  };
  const goToQuestion = (index: number) => {
    cancelAutoAdvance();
    // Leaving unmounts the page's answer field, which would drop a paste or
    // pick that is still converting.
    if (attachmentsPreparing) {
      return;
    }
    Keyboard.dismiss();
    pushDirection.set(index > questionIndex ? 1 : -1);
    setPage({ requestId, index });
    AccessibilityInfo.announceForAccessibility(describeQuestion(index));
  };
  const advance = (scheduledRequestId: RuntimeRequestId) => {
    if (scheduledRequestId !== requestId) {
      return;
    }
    if (!isLastQuestion) {
      goToQuestion(questionIndex + 1);
    } else if (canSubmit) {
      void props.onSubmit();
    }
  };
  // The delayed advance must see the answer the tap just recorded, so it reads
  // the latest render's advance instead of the one that scheduled it, and skips
  // a request that replaced the one tapped.
  const advanceRef = useRef(advance);
  useLayoutEffect(() => {
    advanceRef.current = advance;
  });
  const selectOption = (selectedQuestion: ThreadUserInputQuestion, optionValue: string) => {
    props.onSelectOption(requestId, selectedQuestion, optionValue);
    if (selectedQuestion.multiSelect) {
      return;
    }
    cancelAutoAdvance();
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      advanceRef.current(requestId);
    }, SINGLE_SELECT_ADVANCE_DELAY_MS);
  };

  const cardCoverage = props.cardCoverage;
  const barHeightRef = useRef(0);
  const cardHeightRef = useRef(0);
  const cardHeight = useSharedValue(0);
  const notifyCoverage = useCallback(() => {
    if (!cardCoverage) {
      return;
    }
    const coverage = Math.max(0, cardHeightRef.current - barHeightRef.current);
    if (coverage === cardCoverage.get()) {
      return;
    }
    if (cardCoverage.get() === 0) {
      cardCoverage.set(coverage);
      return;
    }
    cardCoverage.set(
      withTiming(coverage, {
        duration: USER_INPUT_TOGGLE_DURATION_MS,
        easing: Easing.out(Easing.cubic),
      }),
    );
  }, [cardCoverage]);
  const handleBarLayout = useCallback(
    (event: LayoutChangeEvent) => {
      barHeightRef.current = event.nativeEvent.layout.height;
      notifyCoverage();
    },
    [notifyCoverage],
  );
  const handleCardLayout = useCallback(
    (event: LayoutChangeEvent) => {
      cardHeightRef.current = event.nativeEvent.layout.height;
      cardHeight.set(event.nativeEvent.layout.height);
      notifyCoverage();
    },
    [cardHeight, notifyCoverage],
  );
  const cardProgress = props.cardProgress;
  const cardAnimatedStyle = useAnimatedStyle(() => {
    const progress = cardProgress === undefined ? 1 : cardProgress.value;
    return {
      transform: [{ translateY: (1 - progress) * cardHeight.value }],
    };
  });

  // On iOS the card stays MOUNTED while collapsed (hidden via the animated
  // style): expanding animates existing views on the UI thread the same
  // frame the host starts the progress timing, instead of paying a React
  // mount + layout before anything moves.
  const renderCard = EXPANDED_CARD_IS_OVERLAY || !props.collapsed;
  const showBar = props.collapsed || EXPANDED_CARD_IS_OVERLAY;
  const autoDismissAt = props.supportsQuestionAutoDismiss
    ? (props.pendingUserInput.autoDismissAt ?? null)
    : null;
  const bar = showBar ? (
    <View
      onLayout={handleBarLayout}
      pointerEvents={props.collapsed ? "auto" : "none"}
      accessibilityElementsHidden={!props.collapsed}
      importantForAccessibility={props.collapsed ? "auto" : "no-hide-descendants"}
      className="flex-row items-center gap-2 rounded-full border border-border bg-card-alt py-1.5 pl-4 pr-1.5"
    >
      <QuestionAutoDismissToggle
        deadline={autoDismissAt}
        accessibilityLabel={`Expand user input, ${questionCount} question${
          questionCount === 1 ? "" : "s"
        }`}
        onPress={props.onToggleCollapsed}
        className="min-h-10 flex-1 flex-row items-center gap-2 active:opacity-70"
      >
        {(timer) => (
          <>
            <View className="min-w-0 flex-1">
              <View className="flex-row items-center gap-2">
                <Text className="font-supaterm-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
                  User input needed
                </Text>
                <Text className="font-sans text-xs text-foreground-muted">
                  {questionCount} question{questionCount === 1 ? "" : "s"}
                </Text>
              </View>
              {timer}
            </View>
            <SymbolView
              name="chevron.up"
              size={12}
              tintColorClassName={"accent-icon-subtle"}
              type="monochrome"
            />
          </>
        )}
      </QuestionAutoDismissToggle>
      {props.onStopThread ? (
        <ControlPill
          accessibilityLabel="Stop"
          icon="stop.fill"
          variant="danger"
          className="h-9 w-9"
          disabled={!props.canOperateThread}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            props.onStopThread?.();
          }}
        />
      ) : null}
    </View>
  ) : null;
  const card = renderCard ? (
    <Animated.View
      onLayout={handleCardLayout}
      pointerEvents={props.collapsed ? "none" : "auto"}
      accessibilityElementsHidden={props.collapsed}
      importantForAccessibility={props.collapsed ? "no-hide-descendants" : "auto"}
      entering={
        EXPANDED_CARD_IS_OVERLAY
          ? undefined
          : FadeInUp.duration(USER_INPUT_TOGGLE_DURATION_MS).easing(Easing.out(Easing.cubic))
      }
      exiting={
        EXPANDED_CARD_IS_OVERLAY
          ? undefined
          : FadeOutDown.duration(USER_INPUT_TOGGLE_DURATION_MS).easing(Easing.out(Easing.cubic))
      }
      layout={CARD_LAYOUT_TRANSITION}
      className="overflow-hidden gap-2.5 rounded-[20px] border border-border bg-card-alt p-4"
      style={
        EXPANDED_CARD_IS_OVERLAY
          ? [{ maxHeight: props.maxHeight }, cardAnimatedStyle]
          : { maxHeight: props.maxHeight }
      }
    >
      <QuestionAutoDismissToggle
        deadline={autoDismissAt}
        accessibilityLabel={describeQuestion(questionIndex)}
        accessibilityHint="Collapses user input"
        onPress={props.onToggleCollapsed}
        className="flex-row items-center gap-2"
      >
        {(timer) => (
          <>
            <View className="min-w-[33%] flex-1 overflow-hidden">
              <QuestionPage
                questionId={question?.id}
                direction={pushDirection}
                className="flex-row items-center gap-2"
              >
                <Text
                  numberOfLines={1}
                  className="shrink font-supaterm-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary"
                >
                  {question?.header ?? FALLBACK_TITLE}
                </Text>
                {questionCount > 1 ? (
                  <Text className="font-sans text-xs tabular-nums text-foreground-muted">
                    {questionIndex + 1} of {questionCount}
                  </Text>
                ) : null}
              </QuestionPage>
            </View>
            {timer}
            <View className="h-8 w-8 items-center justify-center rounded-full bg-subtle-strong">
              <SymbolView
                name="chevron.down"
                size={13}
                tintColorClassName={"accent-icon-subtle"}
                type="monochrome"
              />
            </View>
          </>
        )}
      </QuestionAutoDismissToggle>
      {/* Remounting per question also starts each page scrolled to its top. */}
      <QuestionPage
        questionId={question?.id}
        direction={pushDirection}
        className="min-h-0"
        style={{ flexShrink: 1 }}
      >
        <ScrollView
          bounces={false}
          className="min-h-0"
          contentContainerClassName="gap-2 pb-1"
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
          style={{ flexShrink: 1 }}
        >
          {!canRespond ? (
            <Text className="font-sans text-sm leading-5 text-foreground-muted">
              The provider process for this request is no longer available. Interrupt or restart the
              run to continue.
            </Text>
          ) : null}
          {question ? (
            <>
              <QuestionText markdown={question.question} />
              {question.multiSelect ? (
                <Text className="font-sans text-xs text-foreground-muted">
                  Select one or more options.
                </Text>
              ) : null}
              <View className="gap-2">
                {question.options.map((option) => {
                  const optionValue = option.value ?? option.label.trim();
                  const selected = isPendingUserInputOptionSelected(
                    question,
                    activeDraft,
                    optionValue,
                  );
                  const description =
                    option.description !== option.label ? option.description : undefined;
                  return (
                    <Pressable
                      key={optionValue}
                      accessibilityRole={question.multiSelect ? "checkbox" : "radio"}
                      accessibilityState={{ checked: selected, disabled: responseDisabled }}
                      disabled={responseDisabled}
                      className={cn(
                        "min-h-12 w-full rounded-2xl border px-3.5 py-3",
                        selected ? "border-primary bg-primary/10" : "border-border bg-input",
                      )}
                      onPress={() => selectOption(question, optionValue)}
                    >
                      <View className="min-w-0 flex-1 gap-0.5">
                        <Text
                          className={cn(
                            "font-supaterm-medium text-sm",
                            selected ? "text-foreground" : "text-foreground-secondary",
                          )}
                        >
                          {option.label}
                        </Text>
                        {description ? (
                          <Text className="font-sans text-sm leading-5 text-foreground-muted">
                            {description}
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {question.allowCustomAnswer !== false ? (
                <QuestionAttachments
                  requestId={requestId}
                  question={question}
                  questions={questions}
                  disabled={responseDisabled}
                  value={activeDraft?.customAnswer ?? ""}
                  onChangeText={(value) =>
                    props.onChangeCustomAnswer(requestId, question.id, value)
                  }
                  onInputFocusChange={props.onInputFocusChange}
                />
              ) : null}
            </>
          ) : null}
        </ScrollView>
      </QuestionPage>
      <View className="flex-row gap-2.5">
        {questionIndex > 0 ? (
          <RequestActionButton
            label="Back"
            size="large"
            tone="secondary"
            disabled={attachmentsPreparing}
            onPress={() => goToQuestion(questionIndex - 1)}
          />
        ) : null}
        <View className="flex-1">
          {isLastQuestion ? (
            <RequestActionButton
              label={questionCount > 1 ? "Submit answers" : "Submit answer"}
              size="large"
              tone={props.answers ? "primary" : "secondary"}
              disabled={!canSubmit}
              onPress={() => {
                cancelAutoAdvance();
                playDecisionHaptic(true);
                void props.onSubmit();
              }}
            />
          ) : (
            <RequestActionButton
              label="Next question"
              size="large"
              tone={questionAnswered ? "primary" : "secondary"}
              disabled={!questionAnswered}
              onPress={() => goToQuestion(questionIndex + 1)}
            />
          )}
        </View>
      </View>
      {props.pendingUserInput.dismissible ? (
        <Pressable
          accessibilityRole="button"
          className="items-center justify-center rounded-2xl px-4 py-2.5 active:opacity-70"
          disabled={isResponding}
          onPress={() => {
            cancelAutoAdvance();
            playDecisionHaptic(false);
            void props.onDismiss();
          }}
        >
          <Text className="font-supaterm-bold text-sm text-foreground-muted">
            Dismiss without answering
          </Text>
        </Pressable>
      ) : null}
      {!props.canOperateThread ? (
        <Text className="font-sans text-xs text-foreground-tertiary">
          This connection cannot submit answers.
        </Text>
      ) : null}
    </Animated.View>
  ) : null;
  return (
    <View className="relative">
      {bar}
      {EXPANDED_CARD_IS_OVERLAY ? (
        <View
          pointerEvents={props.collapsed ? "none" : "box-none"}
          className="absolute inset-x-0 bottom-0 justify-end overflow-hidden"
          style={{ height: props.maxHeight }}
        >
          {card}
        </View>
      ) : (
        card
      )}
    </View>
  );
}
