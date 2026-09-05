import { readdir, readFile } from 'node:fs/promises';
import { parsePromptFiles } from '../src/prompt-config.ts';
const files: Record<string, string> = { 'prompts/common.md': await readFile('prompts/common.md', 'utf8') };
for (const directory of ['research', 'stages']) for (const name of await readdir(`prompts/${directory}`)) {
  if (name.endsWith('.md')) { const path = `prompts/${directory}/${name}`; files[path] = await readFile(path, 'utf8'); }
}
const result = parsePromptFiles(files);
console.log(`提示词校验通过：${result.strategies.length} 个策略，${Object.keys(result.stages).length} 个阶段`);
