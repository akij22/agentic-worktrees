import { useParams } from "react-router-dom";
import { CodingAgentLanding } from "../features/coding-agent/views/CodingAgentLanding";
import { CodingAgentSession } from "../features/coding-agent/views/CodingAgentSession";

export const CodingAgent = () => {
  const { runId } = useParams();
  return runId ? <CodingAgentSession runId={runId} /> : <CodingAgentLanding />;
};
