import { getAnalysisProgress } from '../../modules/paper/analysisUnits';
import { analysisService, projectsService } from '../composition';

export type { ProjectSummary } from './service';
export const listManagedProjects = projectsService.listManagedProjects;
export const createPreparedProject = projectsService.createPreparedProject;
export const renameManagedProject = projectsService.renameManagedProject;
export const deleteManagedProject = projectsService.deleteManagedProject;
export const getProjectStorageOverview = projectsService.getProjectStorageOverview;
export const validateProjectFile = projectsService.validateProjectFile;

export const subscribeManagedProjects = analysisService.subscribe;
export const managedProjectsVersion = analysisService.version;
export function managedProjectStatus(id: string, fallback: string) {
  const state = analysisService.peek(id);
  if (!state) return fallback;
  const progress = state.progress ?? (state.data ? getAnalysisProgress(state.data.paper) : undefined);
  if (state.status === 'running' && progress)
    return `分析中 · 已保存 ${progress.completed}/${progress.total ?? '未知'} 页`;
  if (progress?.ready) return '分析就绪';
  if (state.status === 'paused') return '已暂停 · 可继续';
  if (state.status === 'cancelled') return '已取消 · 可继续';
  if (state.status === 'failed') return '分析失败 · 可重试';
  return fallback;
}
