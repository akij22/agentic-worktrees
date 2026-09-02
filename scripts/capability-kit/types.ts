export interface CapabilityNames { slug: string; capabilityId: string; packageName: string; visibleName: string; symbolName: string; manifestSymbol: string; toolName: string }
export interface CreateCapabilityOptions { rootDirectory: string; slug: string; toolName: string }
export interface CreateCapabilityResult { created: readonly string[]; modified: readonly string[] }
export interface CapabilityFileSystem { readFile(path: string): Promise<string>; writeFile(path: string, content: string): Promise<void>; mkdir(path: string, options: { recursive: boolean }): Promise<void>; rename(from: string, to: string): Promise<void>; rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>; lstat(path: string): Promise<{ isSymbolicLink(): boolean }> }
export interface CreateCapabilityDependencies { filesystem: CapabilityFileSystem; temporarySuffix(): string }
