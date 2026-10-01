export const formatDate = (value: Date) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const isSameDay = (left: Date, right: Date) =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

/**
 * Compact stamp for dense list rows. The day is already carried by the group
 * heading above the row, so repeating it inside the row wastes the width the
 * branch needs.
 */
export const formatListTimestamp = (value: Date, now: Date = new Date()) => {
  const date = new Date(value);
  if (isSameDay(date, now)) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date);
};

export const compactActivity = (content: string | undefined) => {
  if (!content?.trim()) return "Session is ready for the next instruction.";
  return content.replaceAll(/\s+/g, " ").trim();
};
