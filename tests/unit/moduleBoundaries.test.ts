import ts from 'typescript';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('配置边界与模型唯一入口', () => {
  it('配置纯契约和应用用例不引用 UI/数据库/具体适配器，只有 Responses 适配器发模型请求', () => {
    const root = resolve('src');
    const problems: string[] = [];
    const files = readdirSync(root, { recursive: true })
      .filter((file) => /\.(ts|tsx)$/.test(String(file)))
      .map(String);
    for (const file of files) {
      const name = file.replaceAll('\\', '/');
      const source = readFileSync(resolve(root, file), 'utf8');
      const imports = [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const specifier of imports) {
        const target = relative(root, resolve(dirname(resolve(root, file)), specifier)).replaceAll('\\', '/');
        if (
          name.startsWith('app/settings/') &&
          (/^(ui|infrastructure|shared\/persistence)\//.test(target) || specifier === 'react')
        )
          problems.push(`${name} -> ${specifier}`);
        if (name.startsWith('ui/settings/') && /^(infrastructure|shared\/persistence)\//.test(target))
          problems.push(`${name} -> ${specifier}`);
        if (/pi-ai\/(api|providers)\//.test(specifier) && name !== 'infrastructure/llm/responses.ts')
          problems.push(`${name}: model bypass`);
      }
      if (/chat\/completions|openai-completions/.test(source)) problems.push(`${name}: old protocol`);
    }
    expect(problems).toEqual([]);
  });
});

describe('M19 四层及三个领域的完整边界', () => {
  it('纯规则、应用编排和工作台分别守住依赖方向', () => {
    const root = resolve('src');
    const problems: string[] = [];
    for (const file of readdirSync(root, { recursive: true })
      .map(String)
      .filter((name) => /\.(ts|tsx)$/.test(name))) {
      const name = file.replaceAll('\\', '/');
      const pure = name.startsWith('modules/');
      if (pure && !/^modules\/(project|paper|presentation)\//.test(name)) problems.push(`${name}: obsolete domain`);
      const application =
        name.startsWith('app/') && !['app/composition.ts', 'app/App.tsx', 'app/pwa.ts'].includes(name);
      const ui = name.startsWith('ui/');
      if (!pure && !application && !ui) continue;
      const source = readFileSync(resolve(root, file), 'utf8');
      const imports = [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const specifier of imports) {
        const target = relative(root, resolve(dirname(resolve(root, file)), specifier)).replaceAll('\\', '/');
        if (
          /^modules\/paper\/(document|figures|evidence)\.ts$/.test(name) &&
          /^modules\/paper\/(model|paper\.schema|analysisUnits)(?:\.ts)?$/.test(target)
        )
          problems.push(`${name}: child imports aggregate`);
        if (
          /^modules\/presentation\/(content|layout|planning)\//.test(name) &&
          /^modules\/(?:deck|presentation\/editing|presentation\/build)(?:\/|$)/.test(target)
        )
          problems.push(`${name}: shared content/planning depends on editing`);
        const browserDependency = /^(react(?:-dom)?(?:\/|$)|pdfjs-dist|pptxgenjs|@earendil-works\/pi)/.test(specifier);
        const adapter =
          /^(infrastructure|shared\/persistence|shared\/pdf)\//.test(target) ||
          /(?:Repository|Store)(?:\.ts)?$/.test(target);
        if (pure && (/^(app|ui)\//.test(target) || adapter || browserDependency))
          problems.push(`${name} -> ${specifier}`);
        if (application && (/^ui\//.test(target) || adapter || (browserDependency && !name.startsWith('app/llm/'))))
          problems.push(`${name} -> ${specifier}`);
        if (ui && adapter) problems.push(`${name} -> ${specifier}`);
      }
      if (/\bindexedDB\s*\.|\bIDB(?:Database|Transaction|ObjectStore)\b/.test(source))
        problems.push(`${name}: direct IndexedDB`);
      if (
        pure &&
        /\b(?:window|navigator)\s*\.|\bdocument\s*\.\s*(?:createElement|querySelector|body|documentElement|addEventListener)\b/.test(
          source,
        )
      )
        problems.push(`${name}: browser global`);
    }
    expect(problems).toEqual([]);
  });
});

// 类型契约允许反向引用；运行时循环和适配器调用应用业务均需阻止。
it('运行时导入无环，适配器只读取应用类型与公共模型错误', () => {
  const root = resolve('src');
  const files = readdirSync(root, { recursive: true })
    .map(String)
    .filter((name) => /\.(ts|tsx)$/.test(name));
  const known = new Set(files.map((file) => resolve(root, file)));
  const graph = new Map<string, string[]>();
  const problems: string[] = [];
  for (const file of known) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const imports: string[] = [];
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      if (ts.isImportDeclaration(statement)) {
        const clause = statement.importClause;
        if (clause?.isTypeOnly) continue;
        if (
          !clause?.name &&
          clause?.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly)
        )
          continue;
      } else if (statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier);
      const target = [base, base + '.ts', base + '.tsx', resolve(base, 'index.ts'), resolve(base, 'index.tsx')].find(
        (path) => known.has(path),
      );
      if (!target) continue;
      const from = relative(root, file).replaceAll('\\', '/');
      const to = relative(root, target).replaceAll('\\', '/');
      if (from.startsWith('infrastructure/') && to.startsWith('app/') && to !== 'app/llm/modelError.ts')
        problems.push(from + ' -> ' + to);
      imports.push(target);
    }
    graph.set(file, imports);
  }
  const done = new Set<string>();
  const active: string[] = [];
  function visit(file: string) {
    if (active.includes(file)) {
      problems.push(
        active
          .slice(active.indexOf(file))
          .concat(file)
          .map((path) => relative(root, path))
          .join(' -> '),
      );
      return;
    }
    if (done.has(file)) return;
    active.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    active.pop();
    done.add(file);
  }
  for (const file of known) visit(file);
  expect(problems).toEqual([]);
});
