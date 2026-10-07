export type PendingPermission = {
  id: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
};

export type SessionGridDetail = {
  lastActivity: string | undefined;
  lastMessageAt?: number | null;
  isProcessing: boolean;
  additions: number;
  deletions: number;
  changedFiles: number;
  activeCapabilities?: { id: string; name: string }[];
};

export type DiffLine = {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLine: number | null;
  newLine: number | null;
};
