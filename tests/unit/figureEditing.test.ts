import { describe, expect, it } from 'vitest';
import { fixturePaper } from '../fixtures';
import { legacyProject } from '../legacy-fixtures';
import { migratePaperV1 } from '../../src/modules/paper/migration';
import { migrateProjectV1 } from '../../src/modules/project/migration';
import { applyFigureCommand, figureContent, resolveFigureDestination } from '../../src/modules/paper/figureEditing';
import { createFigureSession } from '../../src/app/paper/figureSession';
import { refineFigurePixels } from '../../src/modules/paper/figurePixels';
import { toLocalBox, toPageBox } from '../../src/modules/paper/figureGeometry';
import type { AnalysisProject } from '../../src/app/paper/ports';
const fixture = (): AnalysisProject => {
  const legacy = legacyProject({ id: 'm16', paperId: fixturePaper.id, pdfAssetId: 'pdf', checkpoint: 'paper-ready' });
  const paper = migratePaperV1(fixturePaper, legacy, 'paper.pdf');
  return { project: migrateProjectV1(legacy), paper, assets: {} };
};

describe('图源原子编辑', () => {
  it('旧版整图与 Panel 共用来源时修 Panel 不缩整图；图注片段与人工关联保留', () => {
    let { paper } = fixture();
    const region = paper.figures[0].regions[0];
    const panel = region.panels[0];
    const originalSource = paper.sources.find((source) => source.id === region.sourceId)!;
    const box = originalSource.bbox!;
    const text = 'Figure 3. (A) Measured response. (B–C) Shared measurement.';
    const block = paper.blocks[0];
    block.text = text;
    paper = applyFigureCommand(paper, { kind: 'refresh-associations' });
    expect(paper.figures[0].captionSourceIds).toHaveLength(3);
    const manualSource = paper.figures[0].captionSourceIds![2];
    paper = applyFigureCommand(paper, {
      kind: 'associate',
      regionId: region.id,
      panelId: panel.id,
      links: [{ sourceId: manualSource, role: 'shared' }],
    });
    paper = applyFigureCommand(paper, { kind: 'label', regionId: region.id, panelId: panel.id, label: 'Z' });
    expect(paper.figures[0].regions[0].panels[0].captionAssociation).toMatchObject({
      origin: 'manual',
      status: 'needs-review',
      links: [{ sourceId: manualSource, role: 'shared' }],
    });
    paper = applyFigureCommand(paper, {
      kind: 'box',
      regionId: region.id,
      panelId: panel.id,
      bbox: { ...box, width: box.width * 0.9 },
    });
    expect(paper.sources.find((source) => source.id === region.sourceId)?.bbox).toEqual(box);
    expect(paper.figures[0].regions[0].panels[0].sourceId).not.toBe(region.sourceId);
  });

  it('只改当前图块归属并保留 Panel/Source 身份，已有归属须确认且标签歧义不猜', () => {
    const { paper } = fixture();
    const region = paper.figures[0].regions[0];
    const next = applyFigureCommand(paper, {
      kind: 'add-figure',
      id: 'new',
      documentId: paper.documents[0].id,
      pageNumber: 1,
      bbox: { x: 0.05, y: 0.05, width: 0.1, height: 0.1 },
      destination: { kind: 'new', label: 'Target' },
    });
    const command = {
      kind: 'move-region' as const,
      regionId: region.id,
      destination: { kind: 'existing' as const, figureId: 'new' },
      id: 'unused',
    };
    expect(() => applyFigureCommand(next, command)).toThrow('确认');
    const moved = applyFigureCommand(next, { ...command, confirmed: true });
    expect(moved.figures.find((figure) => figure.id === 'new')!.regions[1]).toMatchObject(region);
    expect(moved.sources.filter((source) => ['figure', 'panel'].includes(source.kind))).toEqual(
      next.sources.filter((source) => ['figure', 'panel'].includes(source.kind)),
    );
    moved.figures.push({ ...moved.figures[0], id: 'duplicate', label: 'Target' });
    expect(() => resolveFigureDestination(moved, 'Target')).toThrow('多个同名');
  });
  it('无 Panel 可确认；Undo 不恢复旧确认，整图缩框不能偷偷移动其他 Panel', () => {
    let { paper } = fixture();
    const before = figureContent(paper);
    const region = paper.figures[0].regions[0];
    expect(() =>
      applyFigureCommand(paper, { kind: 'box', regionId: region.id, bbox: { x: 0, y: 0, width: 0.01, height: 0.01 } }),
    ).toThrow('切掉');
    for (const panel of region.panels)
      paper = applyFigureCommand(paper, { kind: 'delete-panel', regionId: region.id, panelId: panel.id });
    paper = applyFigureCommand(paper, { kind: 'confirm', at: 1 });
    expect(paper.figureReview.confirmedRevision).toBe(paper.figureReview.revision);
    const restored = applyFigureCommand(paper, { kind: 'restore', content: before });
    expect(restored.figureReview.confirmedRevision).toBeUndefined();
    expect(restored.figures[0].regions[0].panels).toEqual(region.panels);
    expect(restored.claims).toEqual(before.claims);
  });
  it('删除唯一图源关联后保留原证据和方法事实，明确来源缺口', () => {
    let { paper } = fixture();
    const region = paper.figures[0].regions[0];
    const source = paper.sources.find((source) => source.id === region.sourceId)!;
    const parent = { ...source, id: 'separate-parent' };
    paper.sources.push(parent);
    region.sourceId = parent.id;
    paper.studyProfile = { type: 'existing design', designSummary: 'Existing method fact.', sourceIds: [source.id] };
    const evidenceBefore = structuredClone(paper.evidences);
    paper = applyFigureCommand(paper, { kind: 'delete-panel', regionId: region.id, panelId: region.panels[0].id });
    expect(paper.evidences.map((evidence) => evidence.summary)).toEqual(
      evidenceBefore.map((evidence) => evidence.summary),
    );
    expect(paper.evidences.some((evidence) => !evidence.sourceIds.length)).toBe(true);
    expect(paper.studyProfile).toEqual({
      type: 'existing design',
      designSummary: 'Existing method fact.',
      sourceIds: [],
    });
  });
  it('保存失败不推进历史；保存中再次输入保留登记并接续新基准', async () => {
    let data = fixture();
    let fail = true;
    let release: (() => void) | undefined;
    const session = createFigureSession(data.project.id, {
      openProject: async () => data,
      saveFigure: async (input) => {
        if (input.command.kind === 'refresh-associations') return data;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        if (fail) throw new Error('quota');
        input.assertCurrent();
        data = {
          ...data,
          paper: { ...applyFigureCommand(data.paper, input.command), revision: data.paper.revision + 1 },
        };
        return data;
      },
    });
    await session.load();
    const region = data.paper.figures[0].regions[0];
    const command = { kind: 'label' as const, regionId: region.id, panelId: region.panels[0].id, label: 'changed' };
    session.register('label');
    const failed = session.save(command);
    release!();
    await expect(failed).rejects.toThrow('quota');
    expect(session.snapshot()).toMatchObject({ dirty: true, canUndo: false });
    fail = false;
    const first = session.save(command);
    session.register('label');
    release!();
    await first;
    expect(session.snapshot()).toMatchObject({ dirty: true, canUndo: true });
    const second = session.save({ ...command, label: 'latest' });
    release!();
    await second;
    expect(session.snapshot().dirty).toBe(false);
    fail = true;
    const undo = session.undo();
    release!();
    await expect(undo).rejects.toThrow();
    expect(session.snapshot()).toMatchObject({ canUndo: true, canRedo: false });
    session.close();
  });
  it('编辑使迟到重识别失效，未应用候选不修改底稿', async () => {
    const data = fixture();
    const session = createFigureSession('m16', { openProject: async () => data, saveFigure: async () => data });
    await session.load();
    let release!: () => void;
    const pending = session.recognize(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { kind: 'restore', content: figureContent(data.paper) };
    });
    session.register('box');
    release();
    await expect(pending).rejects.toThrow();
    expect(session.snapshot().candidate).toBeUndefined();
    expect(session.snapshot().data?.paper).toEqual(data.paper);
    session.close();
  });
});

describe('局部像素与旋转后原页几何', () => {
  it('局部/原页换算与显示缩放无关', () => {
    const frame = { x: 0.2, y: 0.15, width: 0.5, height: 0.7 };
    const box = { x: 0.1, y: 0.2, width: 0.4, height: 0.3 };
    const local = toLocalBox(toPageBox(box, frame), frame);
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(local[key]).toBeCloseTo(box[key]);
  });
  it('不缩小原框，允许共享图例，保留灰色信息并检查空框', () => {
    const data = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    for (let y = 20; y < 70; y++)
      for (let x = 20; x < 70; x++) {
        const i = (y * 100 + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = 210;
      }
    const result = refineFigurePixels({
      width: 100,
      height: 100,
      data,
      boxes: [
        { x: 0.2, y: 0.2, width: 0.49, height: 0.49 },
        { x: 0.01, y: 0.01, width: 0.05, height: 0.05 },
      ],
    });
    expect(result.boxes[0].width).toBeGreaterThanOrEqual(0.49);
    expect(result.issues[1]).toContain('疑似空框，请对照原页');
    expect(data[0]).toBe(255);
  });
});
