import { get, stored, transaction } from '../../shared/persistence/indexedDb';
import { PaperSchema, type Paper } from './paper.schema';
import { projectIn } from '../project/projectRepository';
import type { Project } from '../project/project.schema';

async function readProjectScoped<T>(
  projectId: string,
  reader: (tx: IDBTransaction, project: Project, paper: Paper) => Promise<T>,
) {
  return transaction(['projects', 'papers', 'decks'], 'readonly', async (tx) => {
    const project = await projectIn(tx, projectId);
    const paper = stored(PaperSchema, await get(tx, 'papers', project.paperId), '论文');
    return reader(tx, project, paper);
  });
}
/** AI 只读工具：返回当前项目的论文概要，不暴露其他项目数据。 */
export function getPaper(projectId: string) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => structuredClone(paper));
}
export function getPaperPage(projectId: string, pageNumber: number) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('页码无效');
    const page = paper.pages.find((item) => item.pageNumber === pageNumber);
    if (!page) throw new Error('找不到指定页');
    return structuredClone(page);
  });
}
export function getPaperFigure(projectId: string, figureId: string) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => {
    const figure = paper.figures.find((item) => item.id === figureId);
    if (!figure) throw new Error('找不到指定 Figure');
    return structuredClone(figure);
  });
}
export function getPaperClaim(projectId: string, claimId: string) {
  return readProjectScoped(projectId, async (_tx, _project, paper) => {
    const claim = paper.claims.find((item) => item.id === claimId);
    if (!claim) throw new Error('找不到指定 Claim');
    return structuredClone(claim);
  });
}
