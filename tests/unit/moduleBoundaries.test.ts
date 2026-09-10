import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('M14 已迁移模块依赖与模型唯一入口', () => {
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

// 只约束 M15 已迁移职责；旧 Deck/Outline 仓库在其后续里程碑归位。
describe('M15 项目与论文的实际模块边界', () => {
  it('纯规则、应用编排和工作台分别守住依赖方向', () => {
    const root = resolve('src');
    const pure = new Set([
      'modules/project/model.ts',
      'modules/paper/model.ts',
      'modules/paper/document.ts',
      'modules/paper/figures.ts',
      'modules/paper/evidence.ts',
      'modules/paper/migration.ts',
      'modules/paper/analysisUnits.ts',
      'modules/paper/figureOutput.ts',
      'modules/paper/figureEditing.ts',
      'modules/paper/figureCaptions.ts',
      'modules/paper/figureGeometry.ts',
      'modules/paper/figurePixels.ts',
    ]);
    const problems: string[] = [];
    for (const file of readdirSync(root, { recursive: true })
      .map(String)
      .filter((name) => /\.(ts|tsx)$/.test(name))) {
      const name = file.replaceAll('\\', '/');
      const application = /^(app\/paper|app\/projects|app\/workflows)\//.test(name);
      const ui = /^ui\/(paper|projects)\//.test(name);
      if (!pure.has(name) && !application && !ui) continue;
      const source = readFileSync(resolve(root, file), 'utf8');
      const imports = [...source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
      for (const specifier of imports) {
        const target = relative(root, resolve(dirname(resolve(root, file)), specifier)).replaceAll('\\', '/');
        if (
          /^modules\/paper\/(document|figures|evidence)\.ts$/.test(name) &&
          /^modules\/paper\/(model|paper\.schema|analysisUnits)(?:\.ts)?$/.test(target)
        )
          problems.push(`${name}: child imports aggregate`);
        const browserDependency = /^(react(?:-dom)?(?:\/|$)|pdfjs-dist|pptxgenjs|@earendil-works\/pi)/.test(specifier);
        const adapter =
          /^(infrastructure|shared\/persistence|shared\/pdf)\//.test(target) ||
          /(?:Repository|Store)(?:\.ts)?$/.test(target);
        if (pure.has(name) && (/^(app|ui)\//.test(target) || adapter || browserDependency))
          problems.push(`${name} -> ${specifier}`);
        if (application && (/^ui\//.test(target) || adapter || browserDependency))
          problems.push(`${name} -> ${specifier}`);
        if (ui && adapter) problems.push(`${name} -> ${specifier}`);
      }
      if (/\bindexedDB\s*\.|\bIDB(?:Database|Transaction|ObjectStore)\b/.test(source))
        problems.push(`${name}: direct IndexedDB`);
      if (
        pure.has(name) &&
        /\b(?:window|navigator)\s*\.|\bdocument\s*\.\s*(?:createElement|querySelector|body|documentElement|addEventListener)\b/.test(
          source,
        )
      )
        problems.push(`${name}: browser global`);
    }
    expect(problems).toEqual([]);
  });
});
