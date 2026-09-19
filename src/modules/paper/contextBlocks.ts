import type { TextBlock } from './document';

const sectionHeading =
  /^(?:\d+(?:\.\d+)*[.\s]+)?(?:abstract|introduction|background|results|discussion|conclusions?|materials? and methods|methods|references|研究背景|研究方法|方法|结果|讨论|结论)\s*[:：]?$/i;
const design =
  /randomi[sz]|study design|phase [1-4i]+|clinical trial|we (?:used|conducted|investigated)|研究设计|随机|临床试验|本研究|我们采用/i;
export const isSectionHeading = (block: TextBlock) =>
  block.kind === 'heading' || sectionHeading.test(block.text.trim());

/** 保留完整来源块；标题只辅助定位语境，不据此推断科学结论。 */
export function studyContextBlocks(blocks: TextBlock[]) {
  let inMethods = false;
  return blocks.filter((block) => {
    if (isSectionHeading(block)) inMethods = /methods|方法/i.test(block.text);
    return block.pageNumber === 1 || inMethods || design.test(block.text);
  });
}

export function sectionContextBlocks(blocks: TextBlock[], pageNumber: number) {
  const first = blocks.findIndex((block) => block.pageNumber === pageNumber);
  if (first < 0) return [];
  let start = first;
  while (start > 0 && !isSectionHeading(blocks[start])) start--;
  // 没有可识别的标题时不将整篇冒充同一章节。
  if (!isSectionHeading(blocks[start])) return [];
  let end = first + 1;
  while (end < blocks.length && !isSectionHeading(blocks[end])) end++;
  return blocks.slice(start, end);
}
