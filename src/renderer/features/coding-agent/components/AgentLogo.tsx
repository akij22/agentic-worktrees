import type { CodingAgentKindDto } from "../../../../shared/ipc/schemas";
import openAiLogo from "../../../assets/agents/openai.png";
import openCodeLogo from "../../../assets/agents/opencode.png";

const agentLogoSources: Record<CodingAgentKindDto, string> = {
  codex: openAiLogo,
  opencode: openCodeLogo,
};

export const getAgentLogoSource = (agentKind: CodingAgentKindDto) =>
  agentLogoSources[agentKind];

type AgentLogoProps = {
  agentKind: CodingAgentKindDto;
  alt?: string;
  className?: string;
  invertOnDark?: boolean;
};

export const AgentLogo = ({
  agentKind,
  alt = "Coding agent logo",
  className,
  invertOnDark = true,
}: AgentLogoProps) => (
  <img
    src={getAgentLogoSource(agentKind)}
    alt={alt}
    className={`${invertOnDark ? "dark:invert" : ""} ${className ?? ""}`}
  />
);
