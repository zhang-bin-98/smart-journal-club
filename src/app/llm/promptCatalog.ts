export type ResearchStrategy = { id: string; name: string; description: string; body: string };
export type PromptCatalog = { common: string; stages: Record<string, string>; strategies: ResearchStrategy[] };
export function researchPrompt(prompts: PromptCatalog, id?: string) {
  const strategy =
    prompts.strategies.find((item) => item.id === id) ?? prompts.strategies.find((item) => item.id === 'general')!;
  return { strategy, fallback: !!id && strategy.id !== id };
}
