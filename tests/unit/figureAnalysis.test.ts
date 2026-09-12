import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { BBoxSchema } from '../../src/shared/schema';

describe('图源坐标的模型与运行时共同约束', () => {
  it('发给模型的坐标约束包含范围；运行时仍拒绝右边界和下边界越界', () => {
    expect(z.toJSONSchema(BBoxSchema)).toMatchObject({
      properties: {
        x: { minimum: 0, exclusiveMaximum: 1 },
        y: { minimum: 0, exclusiveMaximum: 1 },
        width: { exclusiveMinimum: 0, maximum: 1 },
        height: { exclusiveMinimum: 0, maximum: 1 },
      },
      description: expect.stringContaining('x+width <= 1'),
    });
    expect(BBoxSchema.safeParse({ x: 0, y: 0, width: 1, height: 1 }).success).toBe(true);
    expect(BBoxSchema.safeParse({ x: 0.8, y: 0, width: 0.3, height: 1 }).success).toBe(false);
    expect(BBoxSchema.safeParse({ x: 0, y: 0.8, width: 1, height: 0.3 }).success).toBe(false);
  });
});
