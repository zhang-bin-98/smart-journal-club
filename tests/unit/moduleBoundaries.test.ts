import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
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
