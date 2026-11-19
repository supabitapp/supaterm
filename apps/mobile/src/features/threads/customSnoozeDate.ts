/** Compose calendars exchange calendar days at UTC midnight, not local instants. */
export function snoozeDateToPickerDate(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())).toISOString();
}

export function applySnoozePickerDate(date: Date, selected: Date) {
  const next = new Date(date);
  next.setFullYear(selected.getUTCFullYear(), selected.getUTCMonth(), selected.getUTCDate());
  return next;
}

export function applySnoozePickerTime(date: Date, selected: Date) {
  const next = new Date(date);
  next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  return next;
}
