import type { SessionStatusTone } from "../types";

export const getSessionStatusTone = (status: string): SessionStatusTone => {
  switch (status) {
    case "busy":
    case "creating":
      return {
        label: "Running",
        badgeClassName: "border-chart-3/35 bg-chart-3/10 text-chart-3",
        indicatorClassName: "animate-pulse bg-chart-3",
      };
    case "waiting_permission":
      return {
        label: "Awaiting input",
        badgeClassName: "border-chart-4/35 bg-chart-4/10 text-chart-4",
        indicatorClassName: "bg-chart-4",
      };
    case "error":
      return {
        label: "Failed",
        badgeClassName:
          "border-destructive/35 bg-destructive/10 text-destructive",
        indicatorClassName: "bg-destructive",
      };
    case "idle":
    default:
      return {
        label: status.replaceAll("_", " "),
        badgeClassName: "border-primary/30 bg-primary/10 text-primary",
        indicatorClassName: "bg-primary",
      };
  }
};
