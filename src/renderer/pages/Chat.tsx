import { useParams } from "react-router-dom";
import { ChatView } from "../features/coding-agent/views/ChatView";

export const Chat = () => {
  const { runId } = useParams();
  return <ChatView activeRunId={runId} />;
};
