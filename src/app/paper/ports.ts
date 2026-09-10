import type { Paper, AnalysisStage, AnalysisUnitTarget } from '../../modules/paper/model';
import type { Project } from '../../modules/project/model';
import type { BBox } from '../../shared/schema';

export type AnalysisProject = { project: Project; paper: Paper; assets: Record<string, { blob: Blob; name: string }> };
export type UnitCommit = {
  projectId: string;
  paperId: string;
  stage: AnalysisStage;
  target: AnalysisUnitTarget;
  inputKey: string;
  result: unknown;
  outcome?: 'completed' | 'no-figure-located';
  signal: AbortSignal;
};
export type PageSelectionInput = {
  projectId: string;
  documentId: string;
  pageNumber: number;
  manualOverride?: 'include' | 'exclude';
  expectedRevision: number;
  confirmRemoval?: boolean;
};
export type AnalysisStore = {
  openProject(id: string): Promise<AnalysisProject>;
  prepareWorkspace?(id: string): Promise<unknown>;
  commitUnit(input: UnitCommit): Promise<AnalysisProject>;
  setPageSelection(input: PageSelectionInput): Promise<AnalysisProject>;
  saveRequirements(id: string, instruction: string): Promise<unknown>;
  openStep(id: string, step: Project['lastOpenedStep']): Promise<unknown>;
};
export type PaperResource = {
  pageCount(): Promise<number>;
  title(): Promise<string | undefined>;
  text(
    pageNumber: number,
    signal: AbortSignal,
  ): Promise<{ width: number; height: number; text: string; blocks: { text: string }[] }>;
  discover(pageNumber: number, signal: AbortSignal): Promise<{ hasImages: boolean }>;
  figureInput(pageNumber: number, signal: AbortSignal): Promise<{ image: string; imageRegions: BBox[] }>;
  localFigure?(
    pageNumber: number,
    bbox: BBox,
    signal: AbortSignal,
  ): Promise<{
    image: string;
    refine: (boxes: BBox[]) => Promise<import('../../modules/paper/figurePixels').PixelResult>;
    release: () => void;
  }>;
  preview(pageNumber: number, signal: AbortSignal): Promise<string>;
  dispose(): Promise<void>;
};
export type ResourceFactory = (blob: Blob) => PaperResource;
