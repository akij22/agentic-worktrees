export const formatDate = (value: Date) =>
  new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export const formatElapsedTime = (value: Date) => {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 60_000),
  );
  if (elapsedMinutes < 1) return "just started";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m elapsed`;
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m elapsed` : `${hours}h elapsed`;
};

export const compactActivity = (content: string | undefined) => {
  if (!content?.trim()) return "Session is ready for the next instruction.";
  return content.replaceAll(/\s+/g, " ").trim();
};
