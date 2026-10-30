import * as IconNodes from "@supaterm/icons/nodes";
import type { IconNode } from "@supaterm/icons/nodes";
import type { AndroidSymbol, SFSymbol, SymbolViewProps } from "expo-symbols";
import { withUniwind } from "uniwind";
import { NodeIcon } from "./NodeIcon";

const ANDROID_ICON_BY_SF_SYMBOL = {
  "face.smiling": IconNodes.SmilePlus,
  tag: IconNodes.Tag,
  pause: IconNodes.Columns,
  "bolt.circle": IconNodes.Zap,
  "circle.fill": IconNodes.Circle,
  plusminus: IconNodes.Diff,
  "git.pull-request.closed": IconNodes.GitPullRequestClosed,
  "git.pull-request.draft": IconNodes.GitPullRequestDraft,
  "git.commit": IconNodes.GitCommit,
  "arrow.branch": IconNodes.GitBranch,
  "arrow.left": IconNodes.ArrowLeft,
  "arrow.right": IconNodes.ArrowRight,
  "arrow.left.arrow.right": IconNodes.ArrowRightLeft,
  "arrow.clockwise": IconNodes.RefreshCw,
  "arrow.down": IconNodes.ArrowDown,
  "arrow.down.circle": IconNodes.CircleArrowDown,
  "arrow.right.circle": IconNodes.CircleArrowRight,
  "arrow.triangle.branch": IconNodes.GitBranch,
  "arrow.triangle.merge": IconNodes.GitMerge,
  "arrow.triangle.pull": IconNodes.GitPullRequest,
  "square.3.layers.3d": IconNodes.Layers,
  "arrow.turn.left.up": IconNodes.Undo,
  "arrow.up": IconNodes.ArrowUp,
  "arrow.up.circle": IconNodes.CircleArrowUp,
  "arrow.up.left.and.arrow.down.right": IconNodes.Expand,
  "arrow.down.right.and.arrow.up.left": IconNodes.Shrink,
  "arrow.up.right": IconNodes.ArrowUpRight,
  "arrow.up.right.circle": IconNodes.CircleArrowUpRight,
  "arrow.uturn.backward": IconNodes.Undo,
  "arrow.uturn.forward": IconNodes.Redo,
  archivebox: IconNodes.Archive,
  "archivebox.fill": IconNodes.Archive,
  "bell.badge": IconNodes.BellRing,
  "bolt.horizontal.circle": IconNodes.Zap,
  brain: IconNodes.Brain,
  "cable.connector": IconNodes.Plug,
  camera: IconNodes.Camera,
  car: IconNodes.Car,
  "chart.bar.xaxis": IconNodes.ChartColumn,
  checkmark: IconNodes.Check,
  "checkmark.circle": IconNodes.CircleCheck,
  "checkmark.circle.fill": IconNodes.CircleCheck,
  circle: IconNodes.Circle,
  "circle.dashed": IconNodes.CircleDashed,
  "circle.inset.filled": IconNodes.CircleDot,
  "circle.dashed.inset.filled": IconNodes.CircleDot,
  "calendar.badge.clock": IconNodes.CalendarClock,
  clock: IconNodes.Clock,
  timer: IconNodes.Clock,
  ticket: IconNodes.Ticket,
  cloud: IconNodes.Cloud,
  cube: IconNodes.Box,
  "chevron.down": IconNodes.ChevronDown,
  "chevron.left": IconNodes.ChevronLeft,
  "chevron.left.forwardslash.chevron.right": IconNodes.Code,
  "chevron.right": IconNodes.ChevronRight,
  "chevron.up": IconNodes.ChevronUp,
  desktopcomputer: IconNodes.Monitor,
  doc: IconNodes.FileText,
  "doc.on.doc": IconNodes.Copy,
  "doc.text": IconNodes.FileText,
  "file.diff": IconNodes.Diff,
  ellipsis: IconNodes.Ellipsis,
  moon: IconNodes.Moon,
  "ellipsis.circle": IconNodes.CircleEllipsis,
  "exclamationmark.triangle": IconNodes.TriangleAlert,
  "exclamationmark.circle": IconNodes.CircleAlert,
  eye: IconNodes.Eye,
  "eye.slash": IconNodes.EyeOff,
  folder: IconNodes.Folder,
  "folder.badge.plus": IconNodes.FolderPlus,
  "folder.fill": IconNodes.Folder,
  gearshape: IconNodes.Settings,
  globe: IconNodes.Globe,
  hammer: IconNodes.Hammer,
  headphones: IconNodes.Headphones,
  house: IconNodes.House,
  "info.circle": IconNodes.Info,
  internaldrive: IconNodes.Database,
  iphone: IconNodes.Smartphone,
  keyboard: IconNodes.Keyboard,
  laptopcomputer: IconNodes.Laptop,
  link: IconNodes.Link,
  "list.number": IconNodes.ListOrdered,
  "line.3.horizontal": IconNodes.Menu,
  "line.3.horizontal.decrease": IconNodes.Filter,
  "line.3.horizontal.decrease.circle": IconNodes.Filter,
  "line.3.horizontal.decrease.circle.fill": IconNodes.FilterFilled,
  macmini: IconNodes.Server,
  macstudio: IconNodes.Monitor,
  magnifyingglass: IconNodes.Search,
  mic: IconNodes.Mic,
  paintbrush: IconNodes.Palette,
  pencil: IconNodes.Pencil,
  "person.crop.circle": IconNodes.UserCircle,
  "person.2": IconNodes.Users,
  "person.fill.checkmark": IconNodes.UserCheck,
  "person.fill.xmark": IconNodes.UserX,
  "person.badge.clock": IconNodes.User,
  "person.badge.plus": IconNodes.UserPlus,
  photo: IconNodes.Image,
  pin: IconNodes.Pin,
  "pin.fill": IconNodes.Pin,
  "pin.slash": IconNodes.PinOff,
  play: IconNodes.Play,
  plus: IconNodes.Plus,
  minus: IconNodes.Minus,
  "slash.circle": IconNodes.CircleSlash,
  "qrcode.viewfinder": IconNodes.QrCode,
  "point.3.connected.trianglepath.dotted": IconNodes.Network,
  "point.topleft.down.curvedto.point.bottomright.up": IconNodes.GitMerge,
  safari: IconNodes.ExternalLink,
  "server.rack": IconNodes.Server,
  stethoscope: IconNodes.Stethoscope,
  "sidebar.left": IconNodes.PanelLeft,
  "sidebar.right": IconNodes.PanelRight,
  "slider.horizontal.3": IconNodes.SlidersHorizontal,
  "square.and.arrow.up": IconNodes.Share,
  "square.and.pencil": IconNodes.SquarePen,
  "square.on.square": IconNodes.Copy,
  "square.grid.2x2": IconNodes.LayoutGrid,
  "square.split.2x1": IconNodes.Columns,
  star: IconNodes.Star,
  "star.fill": IconNodes.StarFilled,
  "sun.max": IconNodes.Sun,
  "stop.fill": IconNodes.StopFilled,
  target: IconNodes.Target,
  terminal: IconNodes.SquareTerminal,
  "text.alignleft": IconNodes.Text,
  "text.bubble": IconNodes.MessageSquareText,
  "questionmark.bubble": IconNodes.MessageCircleQuestion,
  "exclamationmark.shield": IconNodes.ShieldAlert,
  "bubble.left.and.bubble.right": IconNodes.MessageSquareText,
  "bubble.left": IconNodes.MessageSquareText,
  sparkles: IconNodes.Sparkles,
  "plus.bubble": IconNodes.MessageSquarePlus,
  "text.word.spacing": IconNodes.TextSize,
  "textformat.size": IconNodes.FontStyle,
  "textformat.size.larger": IconNodes.ZoomIn,
  "textformat.size.smaller": IconNodes.ZoomOut,
  "tray.and.arrow.up": IconNodes.Upload,
  trash: IconNodes.Trash,
  wifi: IconNodes.Wifi,
  "wifi.slash": IconNodes.CloudOff,
  xmark: IconNodes.X,
  "xmark.circle.fill": IconNodes.CircleXFilled,
} satisfies Partial<
  Record<
    SFSymbol | "git.pull-request.closed" | "git.pull-request.draft" | "git.commit" | "file.diff",
    IconNode
  >
>;
const SF_ICON_LOOKUP: Partial<
  Record<
    SFSymbol | "git.pull-request.closed" | "git.pull-request.draft" | "git.commit" | "file.diff",
    IconNode
  >
> = ANDROID_ICON_BY_SF_SYMBOL;

const ANDROID_ICON_BY_MATERIAL_NAME = {
  auto_awesome: IconNodes.Sparkles,
  bolt: IconNodes.Zap,
  build: IconNodes.Wrench,
  chat: IconNodes.MessageSquareText,
  chat_bubble: IconNodes.MessageSquareText,
  check: IconNodes.Check,
  close: IconNodes.X,
  construction: IconNodes.Hammer,
  content_copy: IconNodes.Copy,
  desktop_windows: IconNodes.Monitor,
  edit: IconNodes.SquarePen,
  error: IconNodes.CircleAlert,
  folder: IconNodes.Folder,
  folder_open: IconNodes.FolderOpen,
  keyboard: IconNodes.Keyboard,
  keyboard_arrow_down: IconNodes.ChevronDown,
  keyboard_arrow_up: IconNodes.ChevronUp,
  keyboard_hide: IconNodes.KeyboardHide,
  lock: IconNodes.Lock,
  more_vert: IconNodes.EllipsisVertical,
  merge: IconNodes.GitMerge,
  psychology: IconNodes.Brain,
  public: IconNodes.Globe,
  remove: IconNodes.Minus,
  smartphone: IconNodes.Smartphone,
  terminal: IconNodes.SquareTerminal,
  visibility: IconNodes.Eye,
} satisfies Partial<Record<AndroidSymbol, IconNode>>;

export type { SFSymbol } from "expo-symbols";
export type AppSymbolName =
  | keyof typeof ANDROID_ICON_BY_SF_SYMBOL
  | {
      ios: SFSymbol;
      android: keyof typeof ANDROID_ICON_BY_MATERIAL_NAME;
    };

export type AppSymbolViewProps = Omit<SymbolViewProps, "name"> & { name: AppSymbolName };

// The icon set has no solid variant of these, so the outline is filled to tell the states apart.
const FILLED_OUTLINE_SF_SYMBOLS: ReadonlySet<string> = new Set(["pin.fill", "circle.fill"]);

export function isAppSymbolName(name: string): name is Extract<AppSymbolName, string> {
  return Object.prototype.hasOwnProperty.call(ANDROID_ICON_BY_SF_SYMBOL, name);
}

function AppSymbolView(props: AppSymbolViewProps) {
  const materialName = typeof props.name === "string" ? undefined : props.name.android;
  const sfSymbol = typeof props.name === "string" ? props.name : props.name.ios;
  const node =
    (materialName ? ANDROID_ICON_BY_MATERIAL_NAME[materialName] : undefined) ??
    (sfSymbol ? SF_ICON_LOOKUP[sfSymbol] : undefined);

  if (!node) {
    return props.fallback ?? null;
  }

  return (
    <NodeIcon
      node={node}
      accessibilityLabel={props.accessibilityLabel}
      color={props.tintColor}
      {...(sfSymbol && FILLED_OUTLINE_SF_SYMBOLS.has(sfSymbol) ? { fill: props.tintColor } : {})}
      size={props.size}
      style={props.style}
      testID={props.testID}
    />
  );
}

export const SymbolView = withUniwind(AppSymbolView);
