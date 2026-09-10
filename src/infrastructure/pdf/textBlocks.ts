export type PdfTextItem = {
  str: string;
  hasEOL: boolean;
  x: number;
  y: number;
  height: number;
};
export type PdfTextBlock = { text: string };
export type PdfTextResult = { text: string; blocks: PdfTextBlock[] };
type TextLine = { text: string; x: number; y: number; height: number };

/** Preserve PDF text fragments; line gaps, type size and first-line indentation delimit paragraphs. */
export function reconstructTextBlocks(items: PdfTextItem[]): PdfTextResult {
  const lines: TextLine[] = [];
  let line: TextLine | undefined;
  const finishLine = () => {
    if (line?.text.trim()) lines.push({ ...line, text: line.text.trim() });
    line = undefined;
  };
  for (const item of items) {
    if (item.str) {
      if (line && Math.abs(item.y - line.y) > Math.max(line.height, item.height, 1) * 0.8) finishLine();
      if (!line) line = { text: '', x: item.x, y: item.y, height: item.height };
      line.text += item.str;
      line.height = Math.max(line.height, item.height);
    }
    if (item.hasEOL) finishLine();
  }
  finishLine();
  const blocks: PdfTextBlock[] = [];
  let current = '';
  let paragraphX = lines[0]?.x ?? 0;
  let previous: TextLine | undefined;
  for (const next of lines) {
    const height = Math.max(next.height, previous?.height ?? 0, 1);
    const indent = next.x - paragraphX;
    const paragraphBreak =
      previous &&
      (Math.abs(next.y - previous.y) > height * 1.7 ||
        Math.abs(next.height - previous.height) > height * 0.12 ||
        (indent > height * 0.8 && indent < height * 4) ||
        Math.abs(next.x - paragraphX) > height * 8);
    if (paragraphBreak) {
      if (current) blocks.push({ text: current });
      current = '';
      paragraphX = next.x;
    }
    paragraphX = Math.min(paragraphX, next.x);
    current += (current ? '\n' : '') + next.text;
    previous = next;
  }
  if (current) blocks.push({ text: current });
  return { text: blocks.map((block) => block.text).join('\n\n'), blocks };
}
