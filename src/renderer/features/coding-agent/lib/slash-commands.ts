export type OpenCodeSlashCommandId =
  | "status"
  | "compact"
  | "model"
  | "stop";

export type OpenCodeSlashCommand = {
  id: OpenCodeSlashCommandId;
  label: string;
  description: string;
};

export const OPEN_CODE_SLASH_COMMANDS: OpenCodeSlashCommand[] = [
  {
    id: "status",
    label: "/status",
    description: "Show session and OpenCode runtime status",
  },
  {
    id: "compact",
    label: "/compact",
    description: "Summarize the conversation to free context",
  },
  {
    id: "model",
    label: "/model",
    description: "Choose the model used by this session",
  },
  {
    id: "stop",
    label: "/stop",
    description: "Stop the active OpenCode turn",
  },
];

export const filterOpenCodeSlashCommands = (
  draft: string,
): OpenCodeSlashCommand[] => {
  if (!draft.startsWith("/") || draft.includes(" ")) return [];
  const query = draft.slice(1).toLocaleLowerCase();
  return OPEN_CODE_SLASH_COMMANDS.filter((command) =>
    command.id.startsWith(query),
  );
};
