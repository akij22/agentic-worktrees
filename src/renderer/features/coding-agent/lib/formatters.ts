export const formatDate = (value: Date) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const compactActivity = (content: string | undefined) => {
  if (!content?.trim()) return "Session is ready for the next instruction.";
  return content.replaceAll(/\s+/g, " ").trim();
};
