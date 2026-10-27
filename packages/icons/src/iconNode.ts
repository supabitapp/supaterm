export type IconNodeTag = "path" | "circle" | "rect" | "line" | "ellipse" | "polyline" | "polygon";

export type IconNodeAttrs = Readonly<Record<string, string>>;

// Drawn on a 24x24 viewBox inside an <svg> that sets fill="none", stroke="currentColor",
// stroke-width 2, and round caps and joins; attrs only carry what differs from that.
export type IconNode = ReadonlyArray<readonly [IconNodeTag, IconNodeAttrs]>;
