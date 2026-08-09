import { execFile } from "node:child_process";

export interface GitRunOptions {
	cwd: string;
	args: string[];
	env?: NodeJS.ProcessEnv;
}

export interface GitRunResult {
	stdout: string;
	stderr: string;
}

export interface GitRunnerOptions {
	cwd: string;
	env: NodeJS.ProcessEnv;
	maxBuffer: number;
}

export type GitRunner = (
	file: string,
	args: string[],
	options: GitRunnerOptions,
) => Promise<GitRunResult>;

export class GitCommandError extends Error {
	readonly args: string[];
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | string | undefined;

	constructor(input: {
		args: string[];
		stdout: string;
		stderr: string;
		exitCode: number | string | undefined;
		cause: unknown;
	}) {
		super(`Git command failed: git ${input.args.join(" ")}`, {
			cause: input.cause,
		});
		this.name = "GitCommandError";
		this.args = input.args;
		this.stdout = input.stdout;
		this.stderr = input.stderr;
		this.exitCode = input.exitCode;
	}
}

const defaultRunner: GitRunner = (file, args, options) =>
	new Promise((resolve, reject) => {
		execFile(
			file,
			args,
			{
				cwd: options.cwd,
				env: options.env,
				encoding: "utf8",
				maxBuffer: options.maxBuffer,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(Object.assign(error, { stdout, stderr }));
					return;
				}
				resolve({ stdout, stderr });
			},
		);
	});

export interface GitProcess {
	run(options: GitRunOptions): Promise<GitRunResult>;
	assertSafeRef(ref: string): Promise<void>;
}

const containsUnsafeRefCharacter = (ref: string): boolean =>
	[...ref].some(
		(character) =>
			character.charCodeAt(0) <= 32 || "~^:?*[\\".includes(character),
	);

const isUnsafeRef = (ref: string): boolean =>
	ref.length === 0 ||
	ref.startsWith("-") ||
	ref.endsWith("/") ||
	ref.endsWith(".lock") ||
	ref.includes("..") ||
	ref.includes("@{") ||
	ref.includes("//") ||
	containsUnsafeRefCharacter(ref);

export const createGitProcess = ({
	runner = defaultRunner,
	maxOutput = 64 * 1024,
}: {
	runner?: GitRunner;
	maxOutput?: number;
} = {}): GitProcess => ({
	async run({ cwd, args, env }) {
		try {
			const result = await runner("git", args, {
				cwd,
				env: { ...process.env, ...env },
				maxBuffer: Math.max(maxOutput * 2, 1024),
			});
			return {
				stdout: result.stdout.slice(0, maxOutput),
				stderr: result.stderr.slice(0, maxOutput),
			};
		} catch (cause) {
			const value = cause as {
				stdout?: unknown;
				stderr?: unknown;
				code?: number | string;
			};
			throw new GitCommandError({
				args,
				stdout:
					typeof value.stdout === "string"
						? value.stdout.slice(0, maxOutput)
						: "",
				stderr:
					typeof value.stderr === "string"
						? value.stderr.slice(0, maxOutput)
						: "",
				exitCode: value.code,
				cause,
			});
		}
	},
	async assertSafeRef(ref) {
		if (isUnsafeRef(ref)) throw new Error(`Unsafe Git ref: ${ref}`);
	},
});
