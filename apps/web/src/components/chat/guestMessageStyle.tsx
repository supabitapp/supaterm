export function guestBubbleClassName(pending: boolean): string {
  return pending ? "border border-dashed border-guest/50 bg-transparent" : "bg-guest-surface";
}

export function GuestMessageName({ name }: { readonly name: string }) {
  return (
    <p className="me-1 text-2xs text-guest-foreground">
      {name}
      <span className="sr-only"> (guest)</span>
    </p>
  );
}
