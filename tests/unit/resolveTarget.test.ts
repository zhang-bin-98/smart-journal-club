import { describe, expect, it } from 'vitest';
import { fixtureDeck, fixturePaper } from '../fixtures';
import { resolveAiTarget } from '../../src/modules/assistant/target/resolveTarget';

const clone = <T>(value: T): T => structuredClone(value);
const target = (request: string, options?: { selectedSlideId?: string; selectedElementId?: string }) =>
  resolveAiTarget(request, clone(fixtureDeck), fixturePaper, options?.selectedSlideId, options?.selectedElementId);

describe('AI 目标解析', () => {
  it('明确页码优先并支持区间', () => {
    expect(target('第 2 页标题短一点').slideIds).toEqual(['slide-2']);
    expect(target('第 1-2 页精简').slideIds).toEqual(['slide-1', 'slide-2']);
    expect(target('前两页精简').slideIds).toEqual(['slide-1', 'slide-2']);
  });

  it('页码越界给出澄清而不是猜测', () => {
    expect(target('第 9 页标题短一点').clarification).toContain('页码超出');
  });

  it('“这一页”使用当前选择', () => {
    expect(target('这一页太挤', { selectedSlideId: 'slide-2' }).slideIds).toEqual(['slide-2']);
  });

  it('按内容类别解析章节范围', () => {
    const result = target('结果部分压缩一下');
    expect(result.slideIds).toEqual(['slide-2']);
    expect(target('方法部分精简').clarification).toContain('没有找到指定部分');
  });

  it('整套请求进入全局范围', () => {
    const result = target('整体压缩到 12 页');
    expect(result.global).toBe(true);
    expect(result.slideIds).toEqual(fixtureDeck.slides.map((slide) => slide.id));
  });

  it('Figure 多处出现且无明确目标时要求澄清', () => {
    const result = target('Figure 3 大一点');
    expect(result.figureId).toBe('fig-3');
    expect(result.clarification).toContain('请指定要调整哪一处');
  });

  it('明确页码内的 Figure 直接定位该页', () => {
    const result = target('第 2 页的 Figure 3 大一点');
    expect(result.figureId).toBe('fig-3');
    expect(result.slideIds).toEqual(['slide-2']);
    expect(result.clarification).toBeUndefined();
  });
});
