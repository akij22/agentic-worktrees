export type PendingPermission = {
  id: string;
  title: string;
  type: string;
  metadata: Record<string, unknown>;
};

export type SessionGridDetail = {
  lastActivity: string | undefined;
  additions: number;
  deletions: number;
  changedFiles: number;
};

export type DiffLine = {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLine: number | null;
  newLine: number | null;
};
