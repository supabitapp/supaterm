import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import { SETTINGS_SECTION_LABELS } from "./settingsSearch";
import { msg, useGT } from "gt-react";

const SETTINGS_BREADCRUMB_LABELS: Readonly<Record<string, string>> = {
  ...SETTINGS_SECTION_LABELS,
  "/settings/diagnostics": msg("Diagnostics"),
  "/settings/open-source-licenses": msg("Open source licenses"),
};

function settingsBreadcrumbLabel(pathname: string): string | null {
  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  return SETTINGS_BREADCRUMB_LABELS[normalizedPathname] ?? null;
}

export function SettingsBreadcrumb({ pathname }: { pathname: string }) {
  const gt = useGT();
  const sectionLabel = settingsBreadcrumbLabel(pathname);

  return (
    <WorkspaceBreadcrumb ariaLabel={gt("Settings breadcrumb")}>
      {sectionLabel ? (
        <>
          <WorkspaceBreadcrumbItem>{msg("Settings")}</WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
        </>
      ) : null}
      <WorkspaceBreadcrumbItem current className="truncate">
        {sectionLabel ?? msg("Settings")}
      </WorkspaceBreadcrumbItem>
    </WorkspaceBreadcrumb>
  );
}
