import { useRef, useState, type PointerEvent } from "react";

import { hexToHsv, hsvToHex, type HsvColor } from "../../../lib/color";
import { Button } from "../../ui/button";
import { ColorHueSlider, ColorSaturationValuePlane } from "../../ui/color-picker";
import { Input } from "../../ui/input";
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from "../../ui/popover";

const HEX_COLOR = /^#[\da-f]{6}$/i;

const toColor = ({ h, s, v }: HsvColor) => hsvToHex(h, s, v).toUpperCase();

// Drags only preview and save once on release, so a drag writes the device once instead of on
// every pointer move. Keyboard steps and typed hex save immediately.
function ColorPanel({
  label,
  value,
  onPreview,
  onCommit,
}: {
  readonly label: string;
  readonly value: string;
  readonly onPreview: (color: string) => void;
  readonly onCommit: (color: string) => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [syncedValue, setSyncedValue] = useState(value);
  const current = toColor(hsv);
  if (syncedValue !== value) {
    setSyncedValue(value);
    if (current !== value) {
      setHsv(hexToHsv(value));
      setHexDraft(null);
    }
  }
  const drag = useRef<string | null>(null);
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button === 0) drag.current = current;
  };
  const change = (next: HsvColor) => {
    setHsv(next);
    const color = toColor(next);
    if (drag.current === null) {
      onCommit(color);
      return;
    }
    drag.current = color;
    onPreview(color);
  };
  const endDrag = () => {
    const color = drag.current;
    drag.current = null;
    if (color !== null) onCommit(color);
  };

  return (
    <div className="w-56 bg-popover">
      <div onPointerDownCapture={startDrag}>
        <ColorSaturationValuePlane
          label={label}
          value={hsv}
          onChange={change}
          onInteractionEnd={endDrag}
          variant="edge"
        />
      </div>
      <div className="grid gap-3 p-3">
        <div onPointerDownCapture={startDrag}>
          <ColorHueSlider
            label={`${label} hue`}
            value={hsv.h}
            onChange={(h) => change({ ...hsv, h })}
            onInteractionEnd={endDrag}
          />
        </div>
        <Input
          nativeInput
          size="compact"
          value={hexDraft ?? current}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setHexDraft(next);
            if (!HEX_COLOR.test(next)) return;
            setHsv(hexToHsv(next));
            onCommit(next.toUpperCase());
          }}
          onBlur={() => setHexDraft(null)}
          font="mono"
          aria-label={`${label} hex`}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

/** A light's color: the swatch opens a picker, and a custom color can go back to the light's own. */
export function SidePulseColorPicker({
  label,
  color,
  custom,
  onPreview,
  onCommit,
  onClose,
  onReset,
}: {
  readonly label: string;
  readonly color: string;
  readonly custom: boolean;
  readonly onPreview: (color: string) => void;
  readonly onCommit: (color: string) => void;
  readonly onClose: () => void;
  readonly onReset: () => void;
}) {
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverTrigger
        render={
          <Button type="button" size="icon-sm" variant="outline" aria-label={`Change ${label}`}>
            <span
              aria-hidden
              className="size-3.5 rounded-full"
              style={{ backgroundColor: color }}
            />
          </Button>
        }
      />
      <PopoverPopup side="bottom" align="end" sideOffset={6} padding="none">
        <ColorPanel label={label} value={color} onPreview={onPreview} onCommit={onCommit} />
        {custom ? (
          <div className="border-t border-border/60 p-1">
            <PopoverClose
              render={
                <Button
                  type="button"
                  size="compact"
                  variant="ghost-muted"
                  className="w-full justify-start"
                  onClick={onReset}
                >
                  Use the light's own color
                </Button>
              }
            />
          </div>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}
