export type SlashCommandId = "status" | "usage" | "compact" | "model" | "stop";

export type SlashCommand = {
  id: SlashCommandId;
  label: string;
  description: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "status",
    label: "/status",
    description: "Show session and runtime status",
  },
  {
    id: "usage",
    label: "/usage",
    description: "Show remaining account usage",
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
    description: "Stop the active agent turn",
  },
];

export const filterSlashCommands = (draft: string): SlashCommand[] => {
  if (!draft.startsWith("/") || draft.includes(" ")) return [];
  const query = draft.slice(1).toLocaleLowerCase();
  return SLASH_COMMANDS.filter((command) => command.id.startsWith(query));
};
