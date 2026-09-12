import { parsePromptFiles } from './promptConfig';
export const prompts = parsePromptFiles(
  import.meta.glob('../../../prompts/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
    string,
    string
  >,
);
