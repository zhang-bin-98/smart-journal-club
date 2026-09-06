import type { AgentTool } from '@earendil-works/pi-agent-core';
import { z } from 'zod';
import type { Deck } from '../../deck/deck.schema';
import type { Paper } from '../../paper/paper.schema';
import type { AiTarget } from '../target/resolveTarget';
import { paperReadDescriptions, paperReadLabels, paperReadSchemas, paperReadTool } from './paperReadTools';
import { deckReadDescriptions, deckReadLabels, deckReadSchemas, deckReadTool } from './deckReadTools';
import { revisionToolSchema } from './revisionTool';

export const proposalToolName = 'deck_propose_revision';
export function createTools({
  paper,
  deck,
  target,
  mode,
  propose,
}: {
  paper: Paper;
  deck: Deck;
  target: AiTarget;
  mode: 'answer' | 'revision';
  propose: (args: unknown) => Promise<unknown>;
}): AgentTool[] {
  function tool(
    name: string,
    label: string,
    description: string,
    schema: z.ZodType,
    execute: (args: unknown) => unknown | Promise<unknown>,
  ): AgentTool {
    return {
      name,
      label,
      description,
      parameters: z.toJSONSchema(schema) as AgentTool['parameters'],
      execute: async (_id, args, signal) => {
        signal?.throwIfAborted();
        const result = await execute(schema.parse(args));
        signal?.throwIfAborted();
        return { content: [{ type: 'text', text: JSON.stringify(result) }], details: result };
      },
    };
  }
  return [
    ...Object.entries(paperReadSchemas).map(([key, schema]) => {
      const name = key as keyof typeof paperReadSchemas;
      return tool(name, paperReadLabels[name], paperReadDescriptions[name], schema, (args) =>
        paperReadTool(name, args, paper),
      );
    }),
    ...Object.entries(deckReadSchemas).map(([key, schema]) => {
      const name = key as keyof typeof deckReadSchemas;
      return tool(name, deckReadLabels[name], deckReadDescriptions[name], schema, (args) =>
        deckReadTool(name, args, deck),
      );
    }),
    ...(mode === 'revision'
      ? [
          tool(
            proposalToolName,
            '验证布局与来源',
            '仅拟定一批内存修改提案，用户应用后才保存。一次请求最多一次；不得扩大 boundTarget。',
            revisionToolSchema(target),
            propose,
          ),
        ]
      : []),
  ];
}
