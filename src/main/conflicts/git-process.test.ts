import { describe, expect, it, vi } from "vitest";
import { GitCommandError, createGitProcess } from "./git-process";

describe("GitProcess", () => {
	it("passes Git arguments without a shell", async () => {
		const runner = vi.fn().mockResolvedValue({ stdout: "ok\n", stderr: "" });
		const process = createGitProcess({ runner });

		await expect(
			process.run({ cwd: "/repo", args: ["status", "--porcelain=v2"] }),
		).resolves.toEqual({ stdout: "ok\n", stderr: "" });
		expect(runner).toHaveBeenCalledWith(
			"git",
			["status", "--porcelain=v2"],
			expect.objectContaining({ cwd: "/repo" }),
		);
	});

	it("rejects unsafe ref names before invoking Git", async () => {
		const runner = vi.fn();
		const process = createGitProcess({ runner });

		await expect(process.assertSafeRef("--upload-pack=evil")).rejects.toThrow(
			/Unsafe Git ref/,
		);
		expect(runner).not.toHaveBeenCalled();
	});

	it("bounds output and preserves non-zero command context", async () => {
		const runner = vi.fn().mockRejectedValue(
			Object.assign(new Error("failed"), {
				stdout: "x".repeat(100),
				stderr: "fatal conflict",
				code: 1,
			}),
		);
		const process = createGitProcess({ runner, maxOutput: 16 });

		const error = await process
			.run({ cwd: "/repo", args: ["merge", "ref"] })
			.catch((cause: unknown) => cause);
		expect(error).toBeInstanceOf(GitCommandError);
		expect((error as GitCommandError).stdout).toHaveLength(16);
		expect((error as GitCommandError).stderr).toBe("fatal conflict");
		expect((error as GitCommandError).args).toEqual(["merge", "ref"]);
	});
});
