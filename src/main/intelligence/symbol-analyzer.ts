import ts from 'typescript';
import { isTypeScriptFamily } from './path-model';
import type { ChangedRange, ChangedSymbol } from './types';

interface AnalyzeChangedSymbolsInput {
  path: string;
  content: string;
  ranges: ChangedRange[];
}

interface SymbolCandidate {
  kind: string;
  name: string;
  qualifiedName: string;
  declarationStart: number;
  declarationEnd: number;
}

const scriptKindFor = (filePath: string): ts.ScriptKind => {
  if (filePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (filePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (filePath.endsWith('.js')) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

const identifierName = (name: ts.DeclarationName | undefined): string | null => {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return null;
};

const executableInitializer = (
  initializer: ts.Expression | undefined,
): boolean => Boolean(
  initializer &&
  (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)),
);

const candidateKind = (node: ts.Node): string | null => {
  if (ts.isMethodDeclaration(node)) return 'method';
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isVariableDeclaration(node) && executableInitializer(node.initializer)) {
    return 'function-variable';
  }
  if (ts.isPropertyDeclaration(node) && executableInitializer(node.initializer)) {
    return 'function-property';
  }
  return null;
};

const declarationName = (node: ts.Node): string | null => {
  if (
    ts.isMethodDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isVariableDeclaration(node) ||
    ts.isPropertyDeclaration(node)
  ) {
    return identifierName(node.name);
  }
  return null;
};

const parentQualifier = (node: ts.Node): string[] => {
  const names: string[] = [];
  let current = node.parent;
  while (current && !ts.isSourceFile(current)) {
    if (
      ts.isClassDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current)
    ) {
      const name = declarationName(current);
      if (name) names.unshift(name);
    }
    current = current.parent;
  }
  return names;
};

const collectCandidates = (sourceFile: ts.SourceFile): SymbolCandidate[] => {
  const candidates: SymbolCandidate[] = [];
  const visit = (node: ts.Node): void => {
    const kind = candidateKind(node);
    const name = declarationName(node);
    if (kind && name) {
      const declarationStart =
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
      const declarationEnd =
        sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
      candidates.push({
        kind,
        name,
        qualifiedName: [...parentQualifier(node), name].join('.'),
        declarationStart,
        declarationEnd,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return candidates;
};

const changedSpan = (range: ChangedRange): { start: number; end: number } => {
  const length = Math.max(1, range.newLines);
  return { start: range.newStart, end: range.newStart + length - 1 };
};

const intersects = (
  candidate: SymbolCandidate,
  span: { start: number; end: number },
): boolean =>
  candidate.declarationStart <= span.end && candidate.declarationEnd >= span.start;

export const analyzeChangedSymbols = ({
  path,
  content,
  ranges,
}: AnalyzeChangedSymbolsInput): ChangedSymbol[] => {
  if (!isTypeScriptFamily(path) || ranges.length === 0) return [];
  const diagnostics = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions: {
      allowJs: true,
      jsx: ts.JsxEmit.Preserve,
      target: ts.ScriptTarget.Latest,
    },
  }).diagnostics ?? [];
  if (diagnostics.some(({ category }) => category === ts.DiagnosticCategory.Error)) {
    return [];
  }
  const sourceFile = ts.createSourceFile(
    path,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(path),
  );

  const candidates = collectCandidates(sourceFile);
  const selected = new Map<string, ChangedSymbol>();
  for (const range of ranges) {
    const span = changedSpan(range);
    const candidate = candidates
      .filter((item) => intersects(item, span))
      .sort((left, right) => {
        const leftSize = left.declarationEnd - left.declarationStart;
        const rightSize = right.declarationEnd - right.declarationStart;
        return leftSize - rightSize || left.qualifiedName.localeCompare(right.qualifiedName);
      })[0];
    if (!candidate) continue;
    const key = [
      candidate.kind,
      candidate.qualifiedName,
      candidate.declarationStart,
      candidate.declarationEnd,
    ].join(':');
    const existing = selected.get(key);
    selected.set(key, {
      ...candidate,
      changedStart: existing
        ? Math.min(existing.changedStart, span.start)
        : span.start,
      changedEnd: existing ? Math.max(existing.changedEnd, span.end) : span.end,
    });
  }

  return [...selected.values()].sort((left, right) =>
    left.declarationStart - right.declarationStart ||
    left.qualifiedName.localeCompare(right.qualifiedName));
};
