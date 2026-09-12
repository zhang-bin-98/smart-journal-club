import type { Project, Preferences } from '../../modules/project/model';
import type { Paper } from '../../modules/paper/model';
import type { Content } from '../../modules/presentation/content';
import type { PlanRecord, GenerationBase } from './planRecord';
export type SpeechTarget = {
  kind: 'plan' | 'deck';
  id: string;
  revision: number;
  content: Content;
  assignments?: Record<string, string[]>;
};
export type SpeechWorkspace = {
  project: Project;
  paper: Paper;
  target?: SpeechTarget;
  record?: PlanRecord;
  base: GenerationBase;
  stale: boolean;
  legacyPlan: boolean;
  planKey: string;
  workingPaper?: Paper;
};
export type SpeechSave = {
  projectId: string;
  target: SpeechTarget;
  content: Content;
  requestId: string;
  restoreAssignments?: Record<string, string[]>;
  assertActive: () => void;
};
export type SpeechStore = {
  open(projectId: string, preferPlan?: boolean): Promise<SpeechWorkspace>;
  save(input: SpeechSave): Promise<SpeechWorkspace>;
  saveGenerated(input: {
    record: PlanRecord;
    expectedPlan: string;
    assertActive: () => void;
    signal: AbortSignal;
  }): Promise<SpeechWorkspace>;
};
export type GenerationPreferences = Preferences;
