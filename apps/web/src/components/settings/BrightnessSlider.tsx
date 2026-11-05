import { useState, type CSSProperties } from "react";

export function BrightnessSlider({
  id,
  brightness,
  disabled,
  onCommit,
}: {
  id: string;
  brightness: number;
  disabled: boolean;
  onCommit: (brightness: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const value = draft ?? brightness;
  const style = {
    "--settings-slider-progress": `${value}%`,
    "--settings-slider-fill-offset": `${0.5 - value / 100}rem`,
  } as CSSProperties;
  // Each write reaches the hardware through main, so a drag is saved once, when it ends.
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== brightness) onCommit(draft);
  };

  return (
    <div className="flex w-full items-center gap-3 sm:w-52">
      <output
        className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
        htmlFor={id}
      >
        {value}%
      </output>
      <input
        aria-label="Brightness"
        className="settings-slider min-w-0 flex-1"
        disabled={disabled}
        id={id}
        max={100}
        min={0}
        step={5}
        style={style}
        type="range"
        value={value}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (Number.isInteger(next) && next >= 0 && next <= 100) setDraft(next);
        }}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </div>
  );
}
