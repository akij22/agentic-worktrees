import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { execFile, spawn, type SpawnOptions } from 'node:child_process';

export const EDITOR_CATALOG = [
  { id: 'vscode', name: 'Visual Studio Code', macApp: 'Visual Studio Code' },
  { id: 'cursor', name: 'Cursor', macApp: 'Cursor' },
  { id: 'zed', name: 'Zed', macApp: 'Zed' },
  { id: 'webstorm', name: 'WebStorm', macApp: 'WebStorm' },
  { id: 'intellij-idea', name: 'IntelliJ IDEA', macApp: 'IntelliJ IDEA' },
  { id: 'sublime-text', name: 'Sublime Text', macApp: 'Sublime Text' },
  { id: 'android-studio', name: 'Android Studio', macApp: 'Android Studio' },
] as const;

export type EditorId = (typeof EDITOR_CATALOG)[number]['id'];

export interface AvailableEditor {
  id: EditorId;
  name: string;
}

interface EditorCommand {
  win32: string;
  linux: string;
}

const EDITOR_COMMANDS: Record<EditorId, EditorCommand> = {
  vscode: { win32: 'code', linux: 'code' },
  cursor: { win32: 'cursor', linux: 'cursor' },
  zed: { win32: 'zed', linux: 'zed' },
  webstorm: { win32: 'webstorm', linux: 'webstorm' },
  'intellij-idea': { win32: 'idea', linux: 'idea' },
  'sublime-text': { win32: 'subl', linux: 'subl' },
  'android-studio': { win32: 'studio64.exe', linux: 'studio' },
};

type SpawnChild = Pick<ReturnType<typeof spawn>, 'unref' | 'once'>;

export interface EditorServiceDependencies {
  platform: NodeJS.Platform;
  exists: (file: string) => boolean;
  isDirectory?: (file: string) => boolean;
  homeDirectory?: string;
  commandExists: (command: string) => Promise<boolean>;
  spawn: (
    command: string,
    args: string[],
    options: SpawnOptions,
  ) => SpawnChild | undefined;
}

export interface EditorService {
  listAvailableEditors(): Promise<AvailableEditor[]>;
  openEditor(editorId: EditorId, worktreePath: string): Promise<void>;
}

const isEditorId = (editorId: string): editorId is EditorId =>
  EDITOR_CATALOG.some((editor) => editor.id === editorId);

const getEditorCommand = (
  editorId: EditorId,
  platform: NodeJS.Platform,
): string | undefined => {
  if (platform === 'win32' || platform === 'linux') {
    return EDITOR_COMMANDS[editorId][platform];
  }

  return undefined;
};

const isEditorInstalled = async (
  editor: (typeof EDITOR_CATALOG)[number],
  dependencies: EditorServiceDependencies,
): Promise<boolean> => {
  if (dependencies.platform === 'darwin') {
    const applicationsDirectories = [
      '/Applications',
      `${dependencies.homeDirectory ?? homedir()}/Applications`,
    ];
    return applicationsDirectories.some((directory) =>
      dependencies.exists(`${directory}/${editor.macApp}.app`),
    );
  }

  const command = getEditorCommand(editor.id, dependencies.platform);
  return command !== undefined && dependencies.commandExists(command);
};

export const createEditorService = (
  dependencies: EditorServiceDependencies,
): EditorService => ({
  async listAvailableEditors(): Promise<AvailableEditor[]> {
    const installedEditors = await Promise.all(
      EDITOR_CATALOG.map(async (editor) => ({
        editor,
        isInstalled: await isEditorInstalled(editor, dependencies),
      })),
    );

    return installedEditors
      .filter(({ isInstalled }) => isInstalled)
      .map(({ editor: { id, name } }) => ({ id, name }));
  },

  async openEditor(editorId: EditorId, worktreePath: string): Promise<void> {
    if (!isEditorId(editorId)) {
      throw new Error(`Unsupported editor: ${editorId}`);
    }

    if (
      !dependencies.exists(worktreePath) ||
      !(dependencies.isDirectory?.(worktreePath) ?? true)
    ) {
      throw new Error(`Worktree does not exist: ${worktreePath}`);
    }

    const editor = EDITOR_CATALOG.find(({ id }) => id === editorId);
    if (!editor) {
      throw new Error(`Unsupported editor: ${editorId}`);
    }

    if (!(await isEditorInstalled(editor, dependencies))) {
      throw new Error(`Editor is not installed: ${editorId}`);
    }

    const [command, args] =
      dependencies.platform === 'darwin'
        ? ['open', ['-a', editor.macApp, worktreePath]]
        : (() => {
            const editorCommand = getEditorCommand(editorId, dependencies.platform);
            if (!editorCommand) {
              throw new Error(`Unsupported platform: ${dependencies.platform}`);
            }

            return [editorCommand, [worktreePath]];
          })();

    let child: SpawnChild | undefined;
    try {
      child = dependencies.spawn(command, args, {
        detached: true,
        stdio: 'ignore',
      });
    } catch (error) {
      throw new Error(`Failed to start editor: ${editorId}`, { cause: error });
    }

    if (!child) {
      throw new Error(`Failed to start editor: ${editorId}`);
    }

    if (dependencies.platform !== 'darwin') {
      // GUI editor processes normally remain alive until the user closes them.
      // Confirm the child started, without tying this operation to its lifetime.
      await new Promise<void>((resolve, reject) => {
        child.once('error', (error) => {
          reject(new Error(`Failed to start editor: ${editorId}`, { cause: error }));
        });
        child.once('spawn', resolve);
        child.unref();
      });
      return;
    }

    await new Promise<void>((resolve, reject) => {
      child.once('error', (error) => {
        reject(new Error(`Failed to start editor: ${editorId}`, { cause: error }));
      });
      child.once('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`Editor exited with code ${code ?? 'unknown'}: ${editorId}`));
      });
      child.unref();
    });
  },
});

const commandExists = (command: string): Promise<boolean> =>
  new Promise((resolve) => {
    const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
    execFile(lookupCommand, [command], (error) => resolve(error === null));
  });

const productionEditorService = createEditorService({
  platform: process.platform,
  exists: existsSync,
  isDirectory: (path) => statSync(path).isDirectory(),
  homeDirectory: homedir(),
  commandExists,
  spawn,
});

export const listAvailableEditors = (): Promise<AvailableEditor[]> =>
  productionEditorService.listAvailableEditors();

export const openEditor = (
  editorId: EditorId,
  worktreePath: string,
): Promise<void> => productionEditorService.openEditor(editorId, worktreePath);
