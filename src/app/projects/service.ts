import { getAnalysisProgress } from '../../modules/paper/analysisUnits';
import type { AnalysisProject } from '../paper/ports';
import type { Project } from '../../modules/project/model';

export type ProjectSummary = {
  id: string;
  name: string;
  paperTitle?: string;
  updatedAt: number;
  stage: 'analysis' | 'sources' | 'script' | 'slides';
  analysisStatus: string;
  primaryFileCount: number;
  supplementFileCount: number;
  slideCount?: number;
};
export type CreatePreparedInput = {
  primary: File;
  supplement?: File;
  name: string;
  nameIsCustom: boolean;
  instruction: string;
};
export function createProjectService({
  store,
  validateFile,
  removeSession,
}: {
  store: {
    listProjects(): Promise<{ project: Project; paper: AnalysisProject['paper']; slideCount?: number }[]>;
    openProject(id: string): Promise<AnalysisProject>;
    createProject(input: {
      primary: File;
      supplement?: File;
      name?: string;
      nameIsCustom?: boolean;
      preferences: { instruction: string };
    }): Promise<AnalysisProject>;
    renameProject(id: string, name: string): Promise<unknown>;
    deleteProject(id: string): Promise<void>;
    readStorageOverview(): Promise<{
      pdfBytes: number;
      assetCount: number;
      usage?: number;
      quota?: number;
      estimateStatus?: 'available' | 'unavailable' | 'failed';
    }>;
  };
  validateFile: (file: File) => Promise<void>;
  removeSession: (id: string) => Promise<void>;
}) {
  return {
    async listManagedProjects(): Promise<ProjectSummary[]> {
      const items = await store.listProjects();
      return Promise.all(
        items.map(async ({ project, paper, slideCount }) => {
          const progress = getAnalysisProgress(paper);
          const stage = {
            'paper-analysis': 'analysis',
            'figure-review': 'sources',
            'outline-speech': 'script',
            slides: 'slides',
          } as const;
          return {
            id: project.id,
            name: project.name,
            paperTitle: paper.metadata.title,
            updatedAt: project.updatedAt,
            stage: stage[project.lastOpenedStep ?? 'paper-analysis'],
            primaryFileCount: paper.documents.filter((doc) => doc.role === 'primary').length,
            supplementFileCount: paper.documents.filter((doc) => doc.role === 'supplement').length,
            slideCount,
            analysisStatus: progress.ready
              ? '分析就绪'
              : progress.completed
                ? `待继续 · 已保存 ${progress.completed}/${progress.total ?? '未知'} 页`
                : '待分析',
          };
        }),
      );
    },
    async createPreparedProject(input: CreatePreparedInput) {
      await validateFile(input.primary);
      if (input.supplement) await validateFile(input.supplement);
      const saved = await store.createProject({
        primary: input.primary,
        supplement: input.supplement,
        name: input.name,
        nameIsCustom: input.nameIsCustom,
        preferences: { instruction: input.instruction },
      });
      return { id: saved.project.id };
    },
    renameManagedProject: (id: string, name: string) => store.renameProject(id, name.trim()),
    async deleteManagedProject(id: string) {
      await removeSession(id);
      await store.deleteProject(id);
    },
    async getProjectStorageOverview() {
      const result = await store.readStorageOverview();
      const estimate =
        result.usage !== undefined && result.quota !== undefined
          ? { status: 'available' as const, usage: result.usage, quota: result.quota }
          : { status: (result.estimateStatus === 'failed' ? 'failed' : 'unavailable') as 'failed' | 'unavailable' };
      return { fileCount: result.assetCount, fileBytes: result.pdfBytes, estimate, readAt: Date.now() };
    },
    validateProjectFile: validateFile,
  };
}
