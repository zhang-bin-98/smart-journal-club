import { fixturePaper } from './fixtures';
import { legacyProject } from './legacy-fixtures';
import { migratePaperV1 } from '../src/modules/paper/migration';
import { migrateProjectV1 } from '../src/modules/project/migration';
import type { Content } from '../src/modules/presentation/content';
import type { SpeechWorkspace } from '../src/app/presentation/ports';
export function speechFixture(): SpeechWorkspace {
  const old = legacyProject({ id: 'm17', paperId: fixturePaper.id, pdfAssetId: 'pdf', checkpoint: 'paper-ready' });
  const paper = migratePaperV1(fixturePaper, old, 'paper.pdf');
  paper.figureReview.confirmedRevision = paper.figureReview.revision;
  paper.figureReview.confirmedAt = 1;
  const project = migrateProjectV1(old);
  const content: Content = {
    title: '完整讲述',
    language: 'zh',
    omissions: [],
    sections: [
      { id: 'chapter-a', kind: 'results', track: 'main', title: '核心发现', purpose: '解释实验' },
      { id: 'chapter-b', kind: 'limitations', track: 'supplement', title: '边界与补充', purpose: '解释局限' },
    ],
    speechParagraphs: [
      { id: 'paragraph-a', sectionId: 'chapter-a', purpose: '实验结果', segmentIds: ['segment-a'] },
      { id: 'paragraph-b', sectionId: 'chapter-b', purpose: '结果的边界', segmentIds: ['segment-b'] },
    ],
    speech: [
      {
        id: 'segment-a',
        paragraphId: 'paragraph-a',
        text: '实验组出现观察到的改变。当前证据支持该结果，但不能扩展到其他条件。',
        claimIds: paper.claims.map((c) => c.id),
        sourceIds: paper.sources.map((s) => s.id),
      },
      {
        id: 'segment-b',
        paragraphId: 'paragraph-b',
        text: '这项结果有明确的实验边界。后续仍需独立验证。',
        claimIds: [],
        sourceIds: [paper.sources[0].id],
      },
    ],
  };
  return {
    project,
    paper,
    base: {
      paperId: paper.id,
      paperRevision: paper.revision,
      figureReviewRevision: paper.figureReview.revision,
      projectPreferences: structuredClone(project.preferences),
    },
    stale: false,
    legacyPlan: false,
    planKey: '',
    target: { kind: 'plan', id: 'plan', revision: 0, content },
  };
}

import { SpeechPlanSchema } from '../src/modules/presentation/planning';
import { buildPresentation } from '../src/modules/presentation/build';
import { groupPreset } from '../src/modules/presentation/layout';
export function slidesFixture() {
  const state = speechFixture();
  const content = state.target!.content;
  const plan = SpeechPlanSchema.parse({
    ...content,
    schemaVersion: 3,
    id: 'plan',
    paperId: state.paper.id,
    paperRevision: state.paper.revision,
    revision: 1,
    status: 'ready',
    createdAt: 1,
    updatedAt: 1,
    slides: content.speech.map((s, index) => ({
      id: `slide-${index}`,
      sectionId: content.speechParagraphs.find((p) => p.id === s.paragraphId)!.sectionId,
      kind: 'result',
      title: '研究发现',
      purpose: '解释',
      message: '',
      layoutId: 'figure-full',
      speechIds: [s.id],
      claimIds: s.claimIds,
      sourceIds: s.sourceIds,
      figures: [{ id: `image-${index}`, figureId: 'fig-3' }],
      figureGroup: groupPreset([`image-${index}`], 'row'),
    })),
  });
  return { state, plan, deck: buildPresentation(plan, state.paper, 'deck', 1) };
}
