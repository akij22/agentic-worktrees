import { describe, expect, it } from "vitest";
import {
  filterSlashCommands,
  SLASH_COMMANDS,
} from "./slash-commands";

describe("session slash commands", () => {
  it("offers the supported session commands when slash is entered", () => {
    expect(filterSlashCommands("/")).toEqual(SLASH_COMMANDS);
  });

  it("filters commands by their typed prefix", () => {
    expect(filterSlashCommands("/co").map(({ id }) => id)).toEqual([
      "compact",
    ]);
  });

  it("does not treat prompts or commands with arguments as palette queries", () => {
    expect(filterSlashCommands("Please /compact")).toEqual([]);
    expect(filterSlashCommands("/compact now")).toEqual([]);
  });

  it("uses descriptions shared by every coding agent", () => {
    expect(SLASH_COMMANDS.map(({ description }) => description).join(" "))
      .not.toContain("OpenCode");
  });
});
