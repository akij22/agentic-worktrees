import { describe, expect, it } from "vitest";
import {
  filterOpenCodeSlashCommands,
  OPEN_CODE_SLASH_COMMANDS,
} from "./slash-commands";

describe("OpenCode slash commands", () => {
  it("offers the supported session commands when slash is entered", () => {
    expect(filterOpenCodeSlashCommands("/")).toEqual(
      OPEN_CODE_SLASH_COMMANDS,
    );
  });

  it("filters commands by their typed prefix", () => {
    expect(filterOpenCodeSlashCommands("/co").map(({ id }) => id)).toEqual([
      "compact",
    ]);
  });

  it("does not treat prompts or commands with arguments as palette queries", () => {
    expect(filterOpenCodeSlashCommands("Please /compact")).toEqual([]);
    expect(filterOpenCodeSlashCommands("/compact now")).toEqual([]);
  });
});
