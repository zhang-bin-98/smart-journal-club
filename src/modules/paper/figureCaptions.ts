import type { Paper } from './model';

/** Only explicit single-letter panel markers/ranges are interpreted; prose articles are excluded. */
export function captionLabels(text: string): string[] {
  const result = new Set<string>();
  for (const match of text.matchAll(
    /\(([a-z](?:\s*[-–,]\s*[a-z])*)\)|\bpanels?\s+([a-z](?:\s*[-–,]\s*[a-z])*)\b|^\s*([a-z])\s*[.,:)]/gi,
  )) {
    const value = (match[1] ?? match[2] ?? match[3]).toUpperCase();
    for (const label of value.match(/[A-Z]/g) ?? []) result.add(label);
    for (const range of value.matchAll(/([A-Z])\s*[-–]\s*([A-Z])/g)) {
      for (let code = range[1].charCodeAt(0); code <= range[2].charCodeAt(0); code++)
        result.add(String.fromCharCode(code));
    }
  }
  return [...result];
}

/** Exact text spans provide separately selectable caption clauses without rewriting original text. */
export function associateFigureCaptions(paper: Paper, figureIds: string[]) {
  const selected = new Set(figureIds);
  for (const figure of paper.figures) {
    if (!selected.has(figure.id)) continue;
    const regionSources = figure.regions.map(
      (region) => paper.sources.find((source) => source.id === region.sourceId)!,
    );
    const labelNumber = figure.label?.match(/(?:fig(?:ure)?\.?\s*)?([sS]?\d+)/i)?.[1];
    const blocks = paper.blocks.filter((block) => {
      if (!regionSources.some((source) => source.documentId === block.documentId)) return false;
      const header = block.text.match(/^\s*(?:fig(?:ure)?\.?\s*([sS]?\d+)|([sS]\d+)\s+fig(?:ure)?)/i);
      return labelNumber && (header?.[1] ?? header?.[2])?.toLowerCase() === labelNumber.toLowerCase();
    });
    const captionIds: string[] = [];
    for (const block of blocks) {
      const starts = [
        0,
        ...[...block.text.matchAll(/\([A-Za-z](?:\s*[-–,]\s*[A-Za-z])*\)\s/g)].map((match) => match.index),
      ].filter((value, index, all) => all.indexOf(value) === index);
      for (let index = 0; index < starts.length; index++) {
        const start = starts[index];
        const end = starts[index + 1] ?? block.text.length;
        if (end <= start) continue;
        let source = paper.sources.find(
          (source) =>
            source.textSpan?.blockId === block.id && source.textSpan.start === start && source.textSpan.end === end,
        );
        if (!source) {
          source = {
            id: `${block.id}:caption:${start}:${end}`,
            kind: 'caption',
            documentId: block.documentId,
            pageNumber: block.pageNumber,
            textSpan: { blockId: block.id, start, end },
            textQuote: block.text.slice(start, end),
          };
          paper.sources.push(source);
        }
        source.kind = 'caption';
        captionIds.push(source.id);
      }
    }
    // Older manually selected spans remain valid even when finer automatic clauses become available.
    figure.captionSourceIds = [...new Set([...captionIds, ...(figure.captionSourceIds ?? [])])];
    const available = paper.sources.filter((source) => figure.captionSourceIds?.includes(source.id));
    for (const panel of figure.regions.flatMap((region) => region.panels)) {
      if (panel.captionAssociation?.origin === 'manual' || panel.captionAssociation?.links.length) continue;
      const label = panel.label?.trim().toUpperCase();
      const links = label
        ? available.flatMap((source) => {
            const labels = captionLabels(source.textQuote ?? '');
            if (labels.includes(label))
              return [{ sourceId: source.id, role: labels.length > 1 ? ('shared' as const) : ('panel' as const) }];
            return [];
          })
        : [];
      panel.captionAssociation = { links, origin: 'automatic', status: links.length ? 'linked' : 'needs-review' };
    }
    // Enrich only existing evidence that already quotes an explicit Figure/panel citation.
    // No scientific claim, prose, or existing manual association is replaced.
    if (labelNumber) {
      const citation = new RegExp(`\\bfig(?:ure)?s?\\.?\\s*${labelNumber}([a-z])\\b`, 'gi');
      for (const evidence of paper.evidences) {
        const textSources = paper.sources.filter(
          (source) => evidence.sourceIds.includes(source.id) && source.textQuote,
        );
        const links = textSources.flatMap((source) => {
          if (!regionSources.some((region) => region.documentId === source.documentId)) return [];
          const labels = [...source.textQuote!.matchAll(citation)].map((match) => match[1].toUpperCase());
          return figure.regions.flatMap((region) =>
            region.panels
              .filter((panel) => panel.label && labels.includes(panel.label.toUpperCase()))
              .map((panel) => panel.sourceId),
          );
        });
        evidence.sourceIds = [...new Set([...evidence.sourceIds, ...links])];
      }
    }
  }
  paper.pendingEvidenceFigureIds = paper.pendingEvidenceFigureIds.filter((id) => !selected.has(id));
}
