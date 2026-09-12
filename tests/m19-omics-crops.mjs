/** Manual M19 source review in original PDF coordinates. */
export async function correctOmicsCrops(page, projectId) {
  const boxes = {
    4: {
      A: [390, 146, 1000, 373],
      B: [390, 374, 1000, 651],
      C: [390, 652, 581, 870],
      D: [580, 652, 790, 990],
      E: [790, 652, 1000, 990],
      whole: [380, 140, 1005, 995],
    },
    5: {
      A: [390, 145, 746, 429],
      B: [750, 145, 1102, 700],
      C: [390, 429, 746, 700],
      D: [390, 715, 750, 985],
      E: [750, 715, 1102, 985],
      whole: [360, 132, 1105, 988],
    },
    7: { F: [635, 715, 1108, 990], G: [635, 715, 1108, 990], H: [635, 715, 1108, 990], I: [635, 715, 1108, 990] },
    11: {
      A: [390, 148, 693, 416],
      B: [718, 148, 1095, 411],
      C: [390, 415, 738, 620],
      D: [735, 410, 1095, 632],
      E: [390, 635, 703, 1060],
      F: [699, 631, 1100, 855],
      G: [699, 631, 1100, 855],
      H: [700, 850, 1100, 1074],
      whole: [388, 142, 1105, 1078],
    },
    13: {
      A: [190, 145, 740, 462],
      B: [750, 145, 1135, 667],
      C: [190, 465, 720, 875],
      D: [750, 685, 1095, 965],
      E: [190, 885, 735, 1216],
      F: [752, 990, 1100, 1216],
      whole: [188, 138, 1140, 1220],
    },
    15: {
      A: [174, 149, 597, 497],
      B: [174, 516, 598, 850],
      C: [174, 867, 540, 1120],
      D: [636, 149, 1133, 401],
      E: [638, 410, 1133, 612],
      F: [598, 630, 1133, 1125],
      whole: [170, 145, 1140, 1132],
    },
    17: {
      A: [205, 150, 680, 490],
      B: [680, 149, 948, 466],
      C: [945, 150, 1142, 459],
      D: [210, 490, 775, 786],
      E: [777, 490, 1125, 680],
      F: [208, 793, 768, 1195],
      G: [775, 685, 1140, 987],
      H: [775, 990, 1060, 1197],
      whole: [200, 144, 1145, 1198],
    },
  };
  return page.evaluate(
    async ({ projectId, boxes }) => {
      const { slidesService } = await import('/src/app/composition.ts');
      const state = await slidesService.open(projectId);
      const session = slidesService.session(state);
      const before = structuredClone(state.current);
      const edits = [],
        mutations = [];
      for (const [index, slide] of state.current.slides.entries())
        for (const element of slide.elements) {
          if (element.type !== 'figure') continue;
          const figure = state.paper.figures.find((f) => f.id === element.figureId);
          const region =
            figure.regions.find((r) => r.id === element.regionId) ||
            figure.regions.find((r) => r.panels.some((p) => p.id === element.panelId)) ||
            figure.regions[0];
          const panel = region.panels.find((p) => p.id === element.panelId);
          const source = state.paper.sources.find((s) => s.id === (panel || region).sourceId);
          const rect = boxes[source.pageNumber]?.[panel?.label || 'whole'];
          if (!rect) continue;
          const [x, y, r, b] = rect;
          const cropOverride = { x: x / 1200, y: y / 1553, width: (r - x) / 1200, height: (b - y) / 1553 };
          mutations.push({ type: 'replace-element', slideId: slide.id, element: { ...element, cropOverride } });
          edits.push({
            slide: index + 1,
            elementId: element.id,
            figure: figure.label,
            panel: panel?.label,
            page: source.pageNumber,
            before: element.cropOverride ?? source.bbox,
            after: cropOverride,
          });
        }
      await session.commit({ type: 'deck' }, mutations, '按原 PDF 恢复完整实验标签、内参、坐标轴和共享图例');
      const saved = await slidesService.open(projectId);
      if (JSON.stringify(saved.paper) !== JSON.stringify(state.paper)) throw new Error('Paper binding changed');
      if (JSON.stringify(saved.current.speech) !== JSON.stringify(before.speech)) throw new Error('Speech changed');
      const { checkPresentation } = await import('/src/app/presentation/checkPresentation.ts');
      return {
        project: saved.project,
        paper: saved.paper,
        deck: saved.current,
        check: checkPresentation(saved.current, saved.paper, true),
        edits,
      };
    },
    { projectId, boxes },
  );
}
