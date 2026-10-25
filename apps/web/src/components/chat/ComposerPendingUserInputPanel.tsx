import { type RuntimeRequestId, type ScopedThreadRef } from "@supaterm/contracts";
import { memo, use, useEffect, useEffectEvent, useRef, useState } from "react";
import { BackgroundThreadContext } from "./backgroundThread";
import { useStableCallback } from "~/hooks/useStableCallback";
import { type PendingUserInput } from "../../session-logic";
import {
  derivePendingUserInputProgress,
  type PendingUserInputDraftAnswer,
} from "../../pendingUserInput";
import { CheckboxMark } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Kbd } from "../ui/kbd";
import { cn } from "~/lib/utils";
import { ComposerBanner } from "./ComposerBanner";
import {
  QuestionAutoDismissAnnouncer,
  QuestionAutoDismissCountdown,
} from "./QuestionAutoDismissTimer";
import ChatMarkdown from "../ChatMarkdown";
import { usePaneInputOwner } from "../../chatPanes/paneScope";

interface PendingUserInputPanelProps {
  pendingUserInputs: PendingUserInput[];
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled?: boolean;
  respondingRequestIds: RuntimeRequestId[];
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
  supportsQuestionAutoDismiss?: boolean | undefined;
}

export const ComposerPendingUserInputPanel = memo(function ComposerPendingUserInputPanel({
  pendingUserInputs,
  cwd,
  threadRef,
  disabled = false,
  respondingRequestIds,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
  supportsQuestionAutoDismiss = false,
}: PendingUserInputPanelProps) {
  if (pendingUserInputs.length === 0) return null;
  const activePrompt = pendingUserInputs[0];
  if (!activePrompt) return null;

  return (
    <ComposerPendingUserInputCard
      key={activePrompt.requestId}
      prompt={activePrompt}
      cwd={cwd}
      threadRef={threadRef}
      disabled={disabled}
      isResponding={respondingRequestIds.includes(activePrompt.requestId)}
      answers={answers}
      questionIndex={questionIndex}
      onToggleOption={onToggleOption}
      onAdvance={onAdvance}
      onDismiss={onDismiss}
      timerDeadline={supportsQuestionAutoDismiss ? (activePrompt.autoDismissAt ?? null) : null}
    />
  );
});

const ComposerPendingUserInputCard = memo(function ComposerPendingUserInputCard({
  prompt,
  cwd,
  threadRef,
  disabled,
  isResponding,
  answers,
  questionIndex,
  onToggleOption,
  onAdvance,
  onDismiss,
  timerDeadline,
}: {
  prompt: PendingUserInput;
  cwd: string | undefined;
  threadRef: ScopedThreadRef;
  disabled: boolean;
  isResponding: boolean;
  answers: Record<string, PendingUserInputDraftAnswer>;
  questionIndex: number;
  onToggleOption: (questionId: string, optionValue: string) => void;
  onAdvance: () => void;
  onDismiss: (requestId: RuntimeRequestId) => void;
  timerDeadline: string | null;
}) {
  // Message-mode requests remain answerable after their provider turn ends.
  const canRespond = prompt.responseCapability !== "not_resumable";
  const responseDisabled = disabled || isResponding || !canRespond;
  const autoAdvanceTimerRef = useRef<number | null>(null);
  // The auto-advance timer fires after the render that armed it.
  const advance = useStableCallback(onAdvance);
  const [optimisticSingleSelect, setOptimisticSingleSelect] = useState<{
    questionId: string;
    optionValue: string;
  } | null>(null);
  const [collapsedQuestionId, setCollapsedQuestionId] = useState<string | null>(null);
  const [summaryFadesIn, setSummaryFadesIn] = useState(false);
  // The active question keys the shortcut listener, so it must keep its identity across renders.
  const progress = derivePendingUserInputProgress(prompt.questions, answers, questionIndex);
  const activeQuestion = progress.activeQuestion;
  const customAnswerActive = progress.customAnswer.trim().length > 0;
  // Read here, before the hooks below, so the compiler can keep `activeQuestion` cached.
  const draftSelectedOptions = activeQuestion?.options.map(
    (option) =>
      !customAnswerActive && progress.selectedOptionValues.includes(option.value ?? option.label),
  );
  const isCollapsed = collapsedQuestionId !== null && collapsedQuestionId === activeQuestion?.id;

  if (
    activeQuestion &&
    !activeQuestion.multiSelect &&
    optimisticSingleSelect &&
    (optimisticSingleSelect.questionId !== activeQuestion.id ||
      (!customAnswerActive &&
        progress.selectedOptionValues.includes(optimisticSingleSelect.optionValue)))
  ) {
    setOptimisticSingleSelect(null);
  }

  // A delayed answer only advances its own question, while permission remains granted.
  useEffect(() => {
    const clearAutoAdvance = () => {
      if (autoAdvanceTimerRef.current !== null) {
        window.clearTimeout(autoAdvanceTimerRef.current);
        autoAdvanceTimerRef.current = null;
      }
    };
    if (disabled || activeQuestion?.id === undefined) clearAutoAdvance();
    return clearAutoAdvance;
  }, [activeQuestion?.id, disabled]);

  const handleOptionSelection = (questionId: string, optionValue: string) => {
    if (disabled || isResponding) return;
    if (activeQuestion?.multiSelect) {
      onToggleOption(questionId, optionValue);
      return;
    }
    setOptimisticSingleSelect({ questionId, optionValue });
    onToggleOption(questionId, optionValue);
    if (autoAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoAdvanceTimerRef.current);
    }
    autoAdvanceTimerRef.current = window.setTimeout(() => {
      autoAdvanceTimerRef.current = null;
      advance();
    }, 200);
  };

  const selectOptionFromShortcut = useEffectEvent(handleOptionSelection);
  const isPaneInputOwner = usePaneInputOwner();
  const backgroundThread = use(BackgroundThreadContext);

  useEffect(() => {
    if (!activeQuestion || responseDisabled || isCollapsed || backgroundThread) return;
    const handler = (event: globalThis.KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !isPaneInputOwner()) return;
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return;
      }
      if (
        target instanceof HTMLElement &&
        target.closest('[contenteditable]:not([contenteditable="false"])')
      ) {
        return;
      }
      const digit = Number.parseInt(event.key, 10);
      if (Number.isNaN(digit) || digit < 1 || digit > 9) return;
      const optionIndex = digit - 1;
      if (optionIndex >= activeQuestion.options.length) return;
      const option = activeQuestion.options[optionIndex];
      if (!option) return;
      event.preventDefault();
      selectOptionFromShortcut(activeQuestion.id, option.value ?? option.label);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activeQuestion, backgroundThread, isCollapsed, isPaneInputOwner, responseDisabled]);

  if (!activeQuestion) {
    return null;
  }

  return (
    <Collapsible
      open={!isCollapsed}
      onOpenChange={(open) => {
        setCollapsedQuestionId(open ? null : activeQuestion.id);
        setSummaryFadesIn(!open);
      }}
    >
      <CollapsibleTrigger
        render={<ComposerBanner.Row render={<button type="button" />} />}
        title={
          isCollapsed ? "Show the question and its options" : "Hide the question and its options"
        }
        data-pending-user-input-toggle={isCollapsed ? "collapsed" : "expanded"}
        className="px-4 pt-1.5"
      >
        <ComposerBanner.Content>
          <span className="min-w-0 truncate font-medium text-muted-foreground">
            {activeQuestion.header}
          </span>
          {isCollapsed ? (
            <span
              data-enter={summaryFadesIn ? "" : undefined}
              onTransitionEnd={() => setSummaryFadesIn(false)}
              className="min-w-0 flex-1 truncate text-secondary-label transition-opacity duration-200 ease-drawer data-enter:starting:opacity-0 motion-reduce:transition-none"
            >
              {activeQuestion.question}
            </span>
          ) : null}
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          {timerDeadline !== null ? (
            <QuestionAutoDismissCountdown deadline={timerDeadline} />
          ) : null}
          {prompt.questions.length > 1 ? (
            <>
              {timerDeadline !== null ? <ComposerBanner.Separator /> : null}
              <span className="shrink-0 font-medium text-muted-foreground tabular-nums">
                {questionIndex + 1}/{prompt.questions.length}
              </span>
            </>
          ) : null}
          <ComposerBanner.ToggleIcon expanded={!isCollapsed} />
          {prompt.dismissible ? (
            <ComposerBanner.Dismiss
              render={<span role="button" tabIndex={0} />}
              aria-label="Dismiss question without answering"
              title="Dismiss question without answering"
              disabled={isResponding}
              data-pending-user-input-dismiss
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                onDismiss(prompt.requestId);
              }}
            />
          ) : null}
        </ComposerBanner.Actions>
      </CollapsibleTrigger>
      {timerDeadline !== null ? <QuestionAutoDismissAnnouncer deadline={timerDeadline} /> : null}
      <CollapsiblePanel>
        <ComposerBanner.Scroll>
          <ComposerBanner.Body className="ps-6 pe-4 pb-1 wrap-anywhere sm:ps-5.5">
            <ChatMarkdown
              text={activeQuestion.question}
              cwd={cwd}
              threadRef={threadRef}
              className="font-medium text-foreground"
            />
            <div className="-ms-2 mt-2 sm:-ms-1.5">
              {activeQuestion.options.map((option, index) => {
                const optionValue = option.value ?? option.label;
                const isOptimisticallySelected =
                  optimisticSingleSelect?.questionId === activeQuestion.id &&
                  optimisticSingleSelect.optionValue === optionValue;
                const isSelected =
                  isOptimisticallySelected || draftSelectedOptions?.[index] === true;
                const className = cn(
                  "group flex w-full items-start gap-2.5 rounded-md bg-transparent py-1.5 ps-2 text-left sm:ps-1.5 outline-none transition-colors duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/25",
                  isSelected ? "text-foreground" : "text-foreground/70 hover:bg-muted/30",
                  (disabled || isResponding) && "opacity-50 cursor-not-allowed",
                  !disabled && !isResponding && "cursor-pointer",
                );
                // The h-5 slots match the label's line box, so the indicator and shortcut stay on its first line.
                const content = (
                  <>
                    <span className="pointer-events-none flex h-5 shrink-0 items-center">
                      {activeQuestion.multiSelect ? (
                        <CheckboxMark checked={isSelected} />
                      ) : (
                        <OptionRadio checked={isSelected} />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 flex flex-col gap-0.5">
                      <span className="text-sm">{option.label}</span>
                      {option.description && option.description !== option.label ? (
                        <span className="text-secondary-label text-2xs">{option.description}</span>
                      ) : null}
                    </div>
                    {index < 9 ? (
                      <span className="flex h-5 w-7 shrink-0 items-center justify-center sm:w-6">
                        <Kbd>{index + 1}</Kbd>
                      </span>
                    ) : null}
                  </>
                );
                return (
                  <button
                    key={`${activeQuestion.id}:${optionValue}`}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={disabled || isResponding}
                    onClick={() => {
                      handleOptionSelection(activeQuestion.id, optionValue);
                    }}
                    className={className}
                  >
                    {content}
                  </button>
                );
              })}
            </div>
          </ComposerBanner.Body>
        </ComposerBanner.Scroll>
      </CollapsiblePanel>
    </Collapsible>
  );
});

// Drawn with ui/radio-group's look instead of using its Radio: Radio only checks inside a
// RadioGroup, whose arrow keys select options and would trip the single-select auto-advance.
function OptionRadio({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-4.5 shrink-0 items-center justify-center rounded-full border border-input bg-background not-dark:bg-clip-padding sm:size-4 dark:bg-input/32",
        checked ? "shadow-none" : "shadow-xs/5",
      )}
    >
      {checked ? (
        <span className="-inset-px absolute flex items-center justify-center rounded-full bg-primary before:size-2 before:rounded-full before:bg-primary-foreground sm:before:size-1.5" />
      ) : null}
    </span>
  );
}
