import { toLegacyPaper, toLegacyProject } from '../../modules/paper/migration';
import { validatePaper } from '../../modules/paper/model';
import { type Paper, PaperSchema } from '../../modules/paper/paper.schema';
import { ProjectSchema as CurrentProjectSchema } from '../../modules/project/model';
import { type Project, ProjectSchema } from '../../modules/project/project.schema';
import { get, request } from '../../shared/persistence/indexedDb';

export async function readLegacyPaper(tx: IDBTransaction, paperId: string, projectId?: string): Promise<Paper> {
  const raw = await get(tx, 'papers', paperId);
  if ((raw as { schemaVersion?: number })?.schemaVersion === 2) {
    const paper = validatePaper(raw);
    if (projectId && paper.projectId !== projectId) throw new Error('论文底稿不属于当前项目。');
    return toLegacyPaper(paper);
  }
  return PaperSchema.parse(raw);
}
export async function readLegacyProject(tx: IDBTransaction, projectId: string): Promise<Project> {
  const raw = await get(tx, 'projects', projectId);
  if ((raw as { schemaVersion?: number })?.schemaVersion === 2) {
    const project = CurrentProjectSchema.parse(raw);
    const paper = validatePaper(await get(tx, 'papers', project.paperId));
    if (paper.projectId !== projectId) throw new Error('论文底稿不属于当前项目。');
    return toLegacyProject(project, paper);
  }
  return ProjectSchema.parse(raw);
}
/** 旧编辑入口只合入元数据和稿件指针，禁止降写对象版本或覆盖工作底稿指针。 */
export async function writeLegacyProject(tx: IDBTransaction, next: Project) {
  const raw = await get(tx, 'projects', next.id);
  if ((raw as { schemaVersion?: number })?.schemaVersion === 2) {
    const current = CurrentProjectSchema.parse(raw);
    const { schemaVersion: _version, pdfAssetId: _asset, paperId: _paper, ...changes } = next;
    const saved = CurrentProjectSchema.parse({ ...current, ...changes });
    await request(tx.objectStore('projects').put(saved, saved.id));
  } else await request(tx.objectStore('projects').put(next, next.id));
}
