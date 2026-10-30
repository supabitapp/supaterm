import type { ReactNode } from "react";

export function AndroidHomeFabLayout(props: {
  readonly onStartNewTask: () => void;
  readonly children: ReactNode;
  readonly sidebar?: boolean;
  readonly disabled?: boolean;
  readonly paneWidth?: number;
}) {
  return <>{props.children}</>;
}

export function androidHomeFabPosition(safeAreaBottom: number, sidebar: boolean | undefined) {
  return {
    right: 16,
    bottom: sidebar ? Math.max(safeAreaBottom, 12) + 6 : safeAreaBottom + 16,
  };
}
