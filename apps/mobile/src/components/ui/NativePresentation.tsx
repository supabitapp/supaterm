import { requireNativeView } from "expo";
import type { ComponentType, ReactElement } from "react";
import type { ViewProps } from "react-native";

export interface PresentationSourceProps extends ViewProps {
  readonly children: ReactElement;
  readonly identifier: string;
}

const NativeSource: ComponentType<PresentationSourceProps> = requireNativeView(
  "SupatermNativeControls",
  "PresentationSource",
);

export function PresentationSource(props: PresentationSourceProps) {
  return <NativeSource {...props} collapsableChildren={false} />;
}
