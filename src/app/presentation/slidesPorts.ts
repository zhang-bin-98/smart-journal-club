import type { Deck } from '../../modules/deck/deck.schema';
import type { Paper } from '../../modules/paper/model';
import type { Project, PdfAsset } from '../../modules/project/model';
import type { PlanRecord } from './planRecord';
import type { PersistRevision } from './DeckSession';

export type SlidesWorkspace = {
  project: Project;
  workingPaper: Paper;
  paper: Paper;
  assets: Record<string, PdfAsset>;
  current?: Deck;
  previous?: Deck;
  candidate?: Deck;
  candidatePaper?: Paper;
  previousPaper?: Paper;
  candidateStale?: string;
  record?: PlanRecord;
  planKey: string;
  candidateKey: string;
};
export type SlidesGuard = { signal: AbortSignal; assertActive: () => void };
export type SlidesStore = {
  open(id: string): Promise<SlidesWorkspace>;
  rememberSlide(projectId: string, deckId: string, slideId: string): Promise<void>;
  savePlan(input: SlidesGuard & { record: PlanRecord; expectedPlan: string }): Promise<SlidesWorkspace>;
  saveBuild(
    input: SlidesGuard & { projectId: string; expectedPlan: string; expectedCandidate: string; deck: Deck },
  ): Promise<SlidesWorkspace>;
  candidate(input: {
    projectId: string;
    expectedCandidate: string;
    action: 'apply' | 'discard';
    assertActive: () => void;
  }): Promise<SlidesWorkspace>;
  restore(input: {
    projectId: string;
    currentId: string;
    previousId: string;
    currentRevision: number;
    previousRevision: number;
    assertActive: () => void;
  }): Promise<SlidesWorkspace>;
  revision(projectId: string): PersistRevision;
};
