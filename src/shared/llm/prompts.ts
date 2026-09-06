import { parsePromptFiles } from './prompt-config';
export const prompts = parsePromptFiles(import.meta.glob('../../../prompts/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>);
export function researchPrompt(id?: string) {
  const strategy = prompts.strategies.find(item => item.id === id) ?? prompts.strategies.find(item => item.id === 'general')!;
  return { strategy, fallback: !!id && strategy.id !== id };
}
