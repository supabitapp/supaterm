export const MAC_ICON_NAME = "app-icon";
export const XCODE_REQUIREMENT = "Xcode 27 or newer";

export function isSupportedXcodeVersion(output: string) {
  const major = output.match(/^Xcode (\d+)(?:\.|$)/m)?.[1];
  return major !== undefined && Number(major) >= 27;
}

export function macIconCompilerArguments(sourceProject: string, outputDirectory: string) {
  return [
    "actool",
    sourceProject,
    "--compile",
    outputDirectory,
    "--platform",
    "macosx",
    "--minimum-deployment-target",
    "11.0",
    "--app-icon",
    MAC_ICON_NAME,
    "--standalone-icon-behavior",
    "all",
    "--output-partial-info-plist",
    `${outputDirectory}/partial.plist`,
  ];
}
