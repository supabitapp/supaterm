import {
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  PaintbrushIcon,
  PenLineIcon,
  PlusIcon,
  TrashIcon,
  UploadIcon,
} from "@supaterm/icons";
import { useId, useState } from "react";
import { BUILT_IN_THEMES } from "@supaterm/shared/themePalettes";
import { useEnvironmentThemeDefinitions } from "../../hooks/useEnvironmentTheme";
import { readThemeHalvesRaw } from "../../hooks/useTheme";
import { cn } from "../../lib/utils";
import {
  getThemeDefinition,
  getThemeModes,
  removeCustomThemes,
  resolveThemeAppearance,
  resolveThemeHalf,
  serializeThemeFile,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemeHalves,
} from "../../themePalette";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { SettingsGroup } from "./SettingsGroup";
import { ThemeImportDialog } from "./ThemeImportDialog";
import { searchableSetting } from "./settingsSearch";
import { useThemeEditorStore } from "./themeEditorStore";
import {
  STANDARD_THEME_CARDS,
  getThemeCardDefinition,
  previewColorsOf,
  ThemePreviewCircle,
  type ThemeCardPreviewColors,
  type ThemeMode,
} from "./ThemePreviewCircles";
import { ThemeWireframe } from "./ThemeWireframe";

const DEFAULT_THEME_VALUE = "__default";

function downloadThemeFile(filename: string, contents: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  // Revoking synchronously can abort the download in some browsers; give the
  // browser time to open the stream first.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function ThemeSwatch({ colors }: { colors: ThemeCardPreviewColors }) {
  return (
    <span
      aria-hidden
      className="size-3.5 shrink-0 rounded-full ring-1 ring-inset ring-foreground/15"
      style={{
        background: `linear-gradient(135deg, ${colors.canvas} 50%, ${colors.messageAction} 50%)`,
      }}
    />
  );
}

export function ThemeLibrary({
  theme,
  setTheme,
  appearanceMode,
  setAppearanceMode,
  customThemes,
  initialAppearance,
  refreshTheme,
  isImportOpen,
  onImportOpenChange,
  themeHalves,
  setThemeHalf,
}: {
  theme: string;
  setTheme: (theme: string) => boolean;
  appearanceMode: ThemeMode;
  setAppearanceMode: (mode: ThemeMode) => boolean;
  customThemes: ReadonlyArray<ThemeDefinition>;
  initialAppearance: ThemeAppearance;
  refreshTheme: () => void;
  isImportOpen: boolean;
  onImportOpenChange: (open: boolean) => void;
  themeHalves: ThemeHalves | null;
  setThemeHalf: (appearance: ThemeAppearance, themeId: string | null) => boolean;
}) {
  const pickerId = useId();
  const openThemeEditor = useThemeEditorStore((store) => store.openThemeEditor);
  const environmentThemes = useEnvironmentThemeDefinitions();
  // Keep the collection after closing so the dialog text remains populated
  // during its exit animation. The next trash action replaces it before reopening.
  const [removalCollection, setRemovalCollection] = useState<ReadonlyArray<ThemeDefinition>>([]);
  const [isThemeRemovalOpen, setIsThemeRemovalOpen] = useState(false);
  const [themeIdsToRemove, setThemeIdsToRemove] = useState<ReadonlyArray<string>>([]);
  const themeIdsToRemoveSet = new Set(themeIdsToRemove);
  const isSingleThemeRemoval = removalCollection.length === 1;
  const removalCollectionLabel =
    removalCollection[0]?.collection?.label ?? removalCollection[0]?.label;

  const notifyThemeSaveFailure = () => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Couldn’t save theme selection",
        description: "Try again.",
      }),
    );
  };

  const notifyThemeRemovalFailure = () => {
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Couldn’t remove theme",
        description: "Try again.",
      }),
    );
  };

  const persistTheme = (nextTheme: string) => {
    const didSave = setTheme(nextTheme);
    if (!didSave) notifyThemeSaveFailure();
    return didSave;
  };

  const openThemeRemoval = (removedTheme: ThemeDefinition) => {
    const collectionId = removedTheme.collection?.id;
    setRemovalCollection(
      collectionId === undefined
        ? [removedTheme]
        : customThemes.filter((customTheme) => customTheme.collection?.id === collectionId),
    );
    setThemeIdsToRemove([removedTheme.id]);
    setIsThemeRemovalOpen(true);
  };

  const removeThemes = (themeIds: ReadonlyArray<string>) => {
    const removedIds = new Set(themeIds);
    if (removedIds.size === 0) return false;
    const removesBase = removedIds.has(getThemeDefinition(theme)?.id ?? "");
    // Captured raw before persistTheme clears the mix: a half naming a
    // published theme whose set has not streamed in yet is pruned from the
    // `themeHalves` prop, and rebuilding from that would drop it.
    const storedHalves = readThemeHalvesRaw();
    // Keep the themes installed if we cannot move the selection off one of
    // them, so the user can retry.
    if (removesBase && !persistTheme(appearanceMode === "system" ? "system" : appearanceMode)) {
      return false;
    }
    for (const appearance of ["light", "dark"] as const) {
      const half = storedHalves[appearance];
      if (half === undefined) continue;
      const next = half && removedIds.has(half) ? null : removesBase ? half : undefined;
      if (next !== undefined && !setThemeHalf(appearance, next)) {
        notifyThemeRemovalFailure();
        return false;
      }
    }
    try {
      removeCustomThemes([...removedIds]);
    } catch {
      notifyThemeRemovalFailure();
      return false;
    }
    return true;
  };

  const handleConfirmRemoveThemes = () => {
    if (removeThemes(themeIdsToRemove)) setIsThemeRemovalOpen(false);
  };

  const baseCardId = getThemeDefinition(theme)?.id ?? null;

  const selectionFor = (appearance: ThemeAppearance) => {
    const resolvedAppearance = resolveThemeAppearance(
      theme,
      appearance === "dark",
      undefined,
      appearance,
      themeHalves,
    );
    return {
      definition: getThemeDefinition(resolveThemeHalf(theme, themeHalves, resolvedAppearance)),
      appearance: resolvedAppearance,
    };
  };

  const assignHalf = (appearance: ThemeAppearance, cardId: string | null) => {
    const otherAppearance = appearance === "light" ? "dark" : "light";
    // Picking the default over a themed base cannot be stored as a half:
    // the base would still own that appearance. Convert the base into an
    // explicit half on the other side so this side falls back to default.
    if (cardId === null && baseCardId !== null) {
      // Read raw, before persistTheme clears the mix: the other half may
      // name a published theme that has not streamed in yet, and falling
      // back to the base would silently rewrite it.
      const otherOwner = readThemeHalvesRaw()[otherAppearance] ?? baseCardId;
      if (!persistTheme(appearanceMode === "system" ? "system" : appearanceMode)) return;
      if (!setThemeHalf(otherAppearance, otherOwner)) {
        setTheme(theme);
        notifyThemeSaveFailure();
      }
      return;
    }
    if (!setThemeHalf(appearance, cardId)) {
      notifyThemeSaveFailure();
    }
  };

  const activeThemeForAppearance = selectionFor(initialAppearance).definition;

  const setMode = (mode: ThemeMode) => {
    if (!setAppearanceMode(mode)) notifyThemeSaveFailure();
  };

  const isCustomTheme = (themeId: string) =>
    customThemes.some((customTheme) => customTheme.id === themeId);

  const swatchColorsFor = (definition: ThemeDefinition | null, appearance: ThemeAppearance) => {
    const card = definition ? getThemeCardDefinition(definition) : STANDARD_THEME_CARDS[0]!;
    return previewColorsOf(card, appearance) ?? card.previews[0]!.colors;
  };

  const selectedColorsFor = (appearance: ThemeAppearance) => {
    const selection = selectionFor(appearance);
    return swatchColorsFor(selection.definition, selection.appearance);
  };

  const renderWireframe = (mode: ThemeMode) => (
    <ThemeWireframe
      className="h-24"
      panes={
        mode === "system"
          ? [
              { clip: "left", colors: selectedColorsFor("light") },
              { clip: "right", colors: selectedColorsFor("dark") },
            ]
          : [{ colors: selectedColorsFor(mode) }]
      }
    />
  );

  const renderModeTiles = () => (
    <div aria-label="Appearance mode" className="grid w-full grid-cols-3 gap-2" role="group">
      {(["system", "light", "dark"] as const).map((mode) => {
        const isActive = appearanceMode === mode;
        return (
          <button
            aria-label={mode === "system" ? "Follow the system appearance" : `Use ${mode} mode`}
            aria-pressed={isActive}
            className={cn(
              "flex cursor-pointer flex-col items-stretch gap-1.5 rounded-xl border p-2 outline-none transition-colors focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-ring",
              isActive
                ? "border-transparent bg-accent/30"
                : "border-border/70 bg-card/60 hover:bg-accent/10",
            )}
            key={mode}
            style={isActive ? { boxShadow: "inset 0 0 0 1px var(--ring)" } : undefined}
            onClick={() => setMode(mode)}
            type="button"
          >
            {renderWireframe(mode)}
            <span
              className={cn(
                "flex items-center justify-center text-xs font-medium",
                isActive ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {mode === "system" ? "System" : mode === "light" ? "Light" : "Dark"}
            </span>
          </button>
        );
      })}
    </div>
  );

  const publishedThemes = environmentThemes.filter(
    (environmentTheme) => !isCustomTheme(environmentTheme.id),
  );

  const renderThemePicker = (appearance: ThemeAppearance) => {
    const { definition: selected, appearance: resolvedAppearance } = selectionFor(appearance);
    const appearanceLabel = appearance === "light" ? "Light" : "Dark";
    const fits = (definition: ThemeDefinition) =>
      definition.id === selected?.id || getThemeModes(definition).includes(appearance);
    const groups = [
      { label: "Built-in", themes: BUILT_IN_THEMES.filter(fits) },
      { label: "Published", themes: publishedThemes.filter(fits) },
      { label: "Custom", themes: customThemes.filter(fits) },
    ];
    const selectedIsCustom = selected !== null && isCustomTheme(selected.id);
    return (
      <div className="flex min-w-0 items-center gap-2 px-3 py-2.5 sm:px-4">
        <label className="w-9 shrink-0 text-sm font-medium" htmlFor={`${pickerId}-${appearance}`}>
          {appearanceLabel}
          <span className="sr-only"> theme</span>
        </label>
        <Select
          value={selected?.id ?? DEFAULT_THEME_VALUE}
          onValueChange={(value) => {
            if (typeof value !== "string") return;
            assignHalf(appearance, value === DEFAULT_THEME_VALUE ? null : value);
          }}
        >
          <SelectTrigger
            id={`${pickerId}-${appearance}`}
            size="comfortable"
            className="w-full min-w-0"
            aria-label={`${appearanceLabel} theme`}
          >
            <ThemeSwatch colors={swatchColorsFor(selected, resolvedAppearance)} />
            <SelectValue>{selected?.label ?? STANDARD_THEME_CARDS[0]!.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem value={DEFAULT_THEME_VALUE}>
              <span className="flex items-center gap-2">
                <ThemeSwatch colors={swatchColorsFor(null, appearance)} />
                {STANDARD_THEME_CARDS[0]!.label}
              </span>
            </SelectItem>
            {groups.map((group) =>
              group.themes.length > 0 ? (
                <SelectGroup key={group.label}>
                  <SelectGroupLabel>{group.label}</SelectGroupLabel>
                  {group.themes.map((definition) => (
                    <SelectItem key={definition.id} value={definition.id}>
                      <span className="flex min-w-0 items-center gap-2">
                        <ThemeSwatch colors={swatchColorsFor(definition, appearance)} />
                        <span className="truncate">{definition.label}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ) : null,
            )}
          </SelectPopup>
        </Select>
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label={`More actions for the ${appearance} theme`}
                size="icon-xl"
                variant="ghost-muted"
              />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              onClick={() =>
                openThemeEditor({
                  editingThemeId: null,
                  seedThemeId: selected?.id ?? null,
                  seedName: `${selected?.label ?? STANDARD_THEME_CARDS[0]!.label} copy`,
                  initialAppearance: appearance,
                })
              }
            >
              <CopyIcon />
              Duplicate theme
            </MenuItem>
            {selected && selectedIsCustom ? (
              <>
                <MenuItem
                  onClick={() =>
                    openThemeEditor({
                      editingThemeId: selected.id,
                      seedThemeId: null,
                      seedName: null,
                      initialAppearance: appearance,
                    })
                  }
                >
                  <PenLineIcon />
                  Edit theme
                </MenuItem>
                <MenuItem
                  onClick={() =>
                    downloadThemeFile(`${selected.id}.json`, serializeThemeFile(selected))
                  }
                >
                  <UploadIcon />
                  Export theme file
                </MenuItem>
                <MenuSeparator />
                <MenuItem variant="destructive" onClick={() => openThemeRemoval(selected)}>
                  <TrashIcon />
                  Remove theme…
                </MenuItem>
              </>
            ) : null}
          </MenuPopup>
        </Menu>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="flex min-h-7 items-center px-3 text-sm font-normal text-foreground/70 sm:px-4">
          {searchableSetting("color-scheme").title}
        </h3>
        {renderModeTiles()}
      </div>
      <div className="space-y-2">
        <div className="flex min-h-7 flex-wrap items-center justify-between gap-3 px-3 sm:px-4">
          <h3 className="text-sm font-normal text-foreground/70">
            {searchableSetting("theme").title}
          </h3>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              size="xs"
              variant="outline"
              onClick={() =>
                openThemeEditor({
                  editingThemeId: null,
                  seedThemeId: activeThemeForAppearance?.id ?? null,
                  seedName: null,
                  initialAppearance,
                })
              }
            >
              <PaintbrushIcon />
              Create theme
            </Button>
            <Button size="xs" variant="outline" onClick={() => onImportOpenChange(true)}>
              <PlusIcon />
              Add theme
            </Button>
          </div>
        </div>
        <SettingsGroup divided={false} className="@container/theme-pickers">
          <div className="grid divide-y divide-border/50 @min-[40rem]/theme-pickers:grid-cols-2 @min-[40rem]/theme-pickers:divide-x @min-[40rem]/theme-pickers:divide-y-0">
            {renderThemePicker("light")}
            {renderThemePicker("dark")}
          </div>
        </SettingsGroup>
      </div>
      <ThemeImportDialog
        onImportedMany={(importedThemes, { updated }) => {
          if (updated) refreshTheme();
          const verb = updated ? "updated" : "added";
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title:
                importedThemes.length === 1
                  ? `${importedThemes[0]!.label} ${verb}`
                  : `${importedThemes.length} themes ${verb}`,
              description: importedThemes.map((imported) => imported.label).join(", "),
            }),
          );
        }}
        onImported={(importedTheme) => {
          const modes = getThemeModes(importedTheme);
          if (modes.length === 1) {
            assignHalf(modes[0]!, importedTheme.id);
            toastManager.add(
              stackedThreadToast({
                type: "success",
                title: `${importedTheme.label} added`,
                description: `It’s now your ${modes[0]!} theme.`,
              }),
            );
            return true;
          }
          if (!persistTheme(importedTheme.id)) return false;
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title: `${importedTheme.label} added`,
              description: "It’s now active.",
            }),
          );
          return true;
        }}
        onOpenChange={onImportOpenChange}
        open={isImportOpen}
      />
      <AlertDialog open={isThemeRemovalOpen} onOpenChange={setIsThemeRemovalOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isSingleThemeRemoval
                ? `Remove “${removalCollection[0]?.label}”?`
                : `Remove themes from “${removalCollectionLabel}”?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isSingleThemeRemoval
                ? "You can add it again with Add theme."
                : "Select the variants you want to remove. You can restore them by importing the extension again."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isSingleThemeRemoval ? null : (
            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto px-6 pb-6 sm:grid-cols-2">
              {removalCollection.map((customTheme) => {
                const checked = themeIdsToRemoveSet.has(customTheme.id);
                const card = getThemeCardDefinition(customTheme);
                const checkboxId = `remove-theme-${customTheme.id}`;
                return (
                  <label
                    className="group relative flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-border/70 bg-muted/25 p-3 has-checked:border-ring has-checked:bg-accent/20 hover:bg-muted/40"
                    htmlFor={checkboxId}
                    key={customTheme.id}
                  >
                    <span className="absolute right-2 top-2 inline-grid size-5 grid-cols-1 sm:size-4">
                      <input
                        checked={checked}
                        className="col-start-1 row-start-1 size-full appearance-none rounded-sm border border-input bg-background outline-none checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring checked:focus-visible:inset-ring-3 checked:focus-visible:inset-ring-background dark:not-checked:bg-input/32 forced-colors:appearance-auto"
                        id={checkboxId}
                        name="themes-to-remove"
                        type="checkbox"
                        onChange={(event) => {
                          const shouldRemove = event.currentTarget.checked;
                          setThemeIdsToRemove((current) =>
                            shouldRemove
                              ? [...current, customTheme.id]
                              : current.filter((themeId) => themeId !== customTheme.id),
                          );
                        }}
                      />
                      <CheckIcon className="pointer-events-none col-start-1 row-start-1 size-3.5 shrink-0 self-center justify-self-center stroke-primary-foreground opacity-0 group-has-checked:opacity-100 sm:size-3" />
                    </span>
                    <span className="flex min-h-12 items-center justify-center gap-1">
                      {card.previews.map((preview) => (
                        <span
                          className="flex size-11 shrink-0 items-center justify-center"
                          key={preview.mode}
                        >
                          <span className="flex scale-75">
                            <ThemePreviewCircle colors={preview.colors} mode={preview.mode} />
                          </span>
                        </span>
                      ))}
                    </span>
                    <p className="max-w-full truncate text-center text-base font-medium text-foreground sm:text-sm">
                      {customTheme.label}
                    </p>
                  </label>
                );
              })}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              disabled={themeIdsToRemove.length === 0}
              variant="destructive"
              onClick={handleConfirmRemoveThemes}
            >
              {isSingleThemeRemoval
                ? "Remove"
                : `Remove selected${themeIdsToRemove.length > 0 ? ` (${themeIdsToRemove.length})` : ""}`}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
