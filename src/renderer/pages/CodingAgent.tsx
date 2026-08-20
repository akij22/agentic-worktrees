import { useParams } from "react-router-dom";
import { CodingAgentLanding } from "../features/coding-agent/views/CodingAgentLanding";

export const CodingAgent = () => {
  const { runId } = useParams();
  return <CodingAgentLanding activeRunId={runId} />;
};
