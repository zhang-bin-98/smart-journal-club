import { parseDocument } from 'yaml';
import { z } from 'zod';

const HeaderSchema = z.strictObject({ name: z.string().trim().min(1), description: z.string().trim().min(1) });
export type ResearchStrategy = { id: string; name: string; description: string; body: string };
export function parsePromptFiles(files: Record<string, string>) {
  const strategies: ResearchStrategy[] = []; const stages: Record<string, string> = {}; let common = '';
  for (const [path, text] of Object.entries(files)) {
    const research = /\/research\/([a-z0-9-]+)\.md$/.exec(path);
    const stage = /\/stages\/([a-z0-9-]+)\.md$/.exec(path);
    if (research) {
      const parts = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(text);
      if (!parts) throw new Error(`${path} 缺少 YAML 头信息`);
      const document = parseDocument(parts[1]); if (document.errors.length) throw new Error(`${path} YAML 无效`);
      const header = HeaderSchema.parse(document.toJS()); const body = parts[2].trim();
      if (!body || strategies.some(item => item.id === research[1])) throw new Error(`${path} 正文为空或 ID 重复`);
      strategies.push({ id: research[1], ...header, body });
    } else if (stage) { if (!text.trim() || stages[stage[1]]) throw new Error(`${path} 阶段提示词为空或重复`); stages[stage[1]] = text.trim(); }
    else if (path.endsWith('/common.md')) common = text.trim();
    else throw new Error(`未知提示词文件：${path}`);
  }
  if (!common || !['figures', 'understand', 'plan', 'generate'].every(stage => stages[stage]) || !strategies.some(item => item.id === 'general')) throw new Error('缺少必要提示词或 general 策略');
  return { common, stages, strategies };
}
