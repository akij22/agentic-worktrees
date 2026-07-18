import { useParams } from "react-router-dom";
import { CodingAgentLanding } from "../features/coding-agent/views/CodingAgentLanding";
import { CodingAgentWorkspace } from "../features/coding-agent/views/CodingAgentWorkspace";

export const CodingAgent = () => {
  const { runId } = useParams();
  return runId ? (
    <CodingAgentWorkspace primaryRunId={runId} />
  ) : (
    <CodingAgentLanding />
  );
};
