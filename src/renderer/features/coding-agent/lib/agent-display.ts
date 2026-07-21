export const getAgentDisplay = (agentName: string) => ({
  working: `${agentName} is working…`,
  empty: `Ask ${agentName} to make a change in this worktree.`,
  placeholder: `Describe the change you want ${agentName} to make…`,
  stopLabel: `Stop ${agentName}`,
  messageLabel: `${agentName} message`,
  permissionTitle: `${agentName} requests permission`,
  exitError: `The ${agentName} server stopped unexpectedly.`,
});
