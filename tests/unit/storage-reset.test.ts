import { describe, expect, it, vi } from 'vitest';
import { createStorageReset } from '../../src/app/settings/resetStorage';

describe('storage reset command', () => {
  it('refuses active tasks before touching storage', async () => {
    const clear = vi.fn(async () => {});
    await expect(createStorageReset(clear, () => true)()).rejects.toMatchObject({
      stage: 'settings',
      code: 'reset-busy',
    });
    expect(clear).not.toHaveBeenCalled();
  });
  it('blocks duplicate commands and allows retry after failure without exposing raw errors', async () => {
    let reject!: (error: Error) => void;
    const clear = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, fail) => {
            reject = fail;
          }),
      )
      .mockResolvedValue(undefined);
    const reset = createStorageReset(clear, () => false);
    const first = reset();
    await expect(reset()).rejects.toMatchObject({ code: 'reset-busy' });
    reject(new Error('raw provider secret'));
    await expect(first).rejects.toMatchObject({ message: '清理未全部完成，可能已删除部分数据。请保留此页并重试。' });
    await expect(reset()).resolves.toBeUndefined();
    expect(clear).toHaveBeenCalledTimes(2);
  });
});
