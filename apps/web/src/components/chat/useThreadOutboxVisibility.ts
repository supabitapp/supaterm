import { useEffect, useState } from "react";

export function useThreadOutboxVisibility(
  scope: string,
  hasPending: boolean,
  needsAttention: boolean,
) {
  const [visibility, setVisibility] = useState({ scope, hasPending, open: needsAttention });
  if (
    visibility.scope !== scope ||
    visibility.hasPending !== hasPending ||
    (needsAttention && !visibility.open)
  ) {
    setVisibility({ scope, hasPending, open: needsAttention });
  }

  useEffect(() => {
    if (!hasPending) return;
    const timeout = setTimeout(() => setVisibility({ scope, hasPending, open: true }), 1_000);
    return () => clearTimeout(timeout);
  }, [scope, hasPending]);

  return hasPending && visibility.open;
}
