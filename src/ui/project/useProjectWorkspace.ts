import { useEffect, useState } from 'react';
import { PdfResource } from '../../shared/pdf/pdfResource';
import { loadProject, type ProjectData } from '../../modules/project/projectRepository';
import { beginActivity } from '../../app/activity';
import { errorMessage } from '../controls';

export type OpenProject = { data: ProjectData; resource?: PdfResource; controller: AbortController };
/** 打开项目工作区：加载项目数据并持有 PdfResource；切换或卸载时中止旧任务并释放资源。 */
export function useProjectWorkspace(id: string) {
  const [opened, setOpened] = useState<OpenProject>();
  const [error, setError] = useState('');
  useEffect(() => {
    const done = beginActivity();
    const controller = new AbortController();
    let resource: PdfResource | undefined;
    setOpened(undefined);
    setError('');
    loadProject(id)
      .then(
        (data) => {
          if (controller.signal.aborted) return;
          if (data.asset) resource = new PdfResource(data.asset.blob);
          setOpened({ data, resource, controller });
        },
        (cause) => {
          if (!controller.signal.aborted) setError(errorMessage(cause));
        },
      )
      .finally(done);
    return () => {
      controller.abort();
      void resource?.dispose().catch(() => {});
    };
  }, [id]);
  return { opened, error };
}
