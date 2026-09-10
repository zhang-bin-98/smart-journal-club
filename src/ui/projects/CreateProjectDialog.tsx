import { FileUp } from 'lucide-react';
import { Button, inputClass } from '../controls';
import { ProjectDialog } from './ProjectDialog';
import { formatBytes } from './StorageOverview';
import { useProjectCreation } from './useProjectCreation';

export function CreateProjectDialog({
  modelReady,
  onSettings,
  onClose,
  onCreated,
  onBusyChange,
}: {
  modelReady: boolean;
  onSettings: () => void;
  onClose: () => void;
  onCreated: (id: string, start: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const { draft, reading, fileErrors, error, saving, busy, change, choose, save, remove } = useProjectCreation({
    modelReady,
    onCreated,
    onBusyChange,
  });
  return (
    <ProjectDialog title="新建项目" busy={busy} onClose={onClose}>
      <p className="mb-5 text-xs text-muted">一篇论文，一个项目。两份材料会共同整理发现与证据。</p>
      <div className="grid grid-cols-2 gap-4">
        {(['primary', 'supplement'] as const).map((role) => {
          const title = role === 'primary' ? '主论文 PDF' : '补充材料 PDF';
          return (
            <section
              key={role}
              className="rounded border border-control bg-canvas p-5"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void choose(role, event.dataTransfer.files);
              }}
            >
              <h3 className="text-sm font-medium">
                {title} <span className="text-xs text-muted">{role === 'primary' ? '必填' : '可选'}</span>
              </h3>
              <p className="mb-4 mt-2 text-xs text-muted">
                {role === 'primary' ? '包含论文正文和主图' : '附图、附表和补充方法等'}
              </p>
              <label className="inline-flex cursor-pointer items-center gap-2 rounded border border-control bg-white px-3 py-2 text-xs focus-within:outline-2 focus-within:outline-focus">
                <FileUp size={14} />
                {reading[role] ? '正在读取…' : draft[role] ? '更换文件' : '选择文件'}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-label={`选择${title}`}
                  className="sr-only"
                  disabled={busy}
                  onChange={(event) => {
                    if (event.target.files?.length) void choose(role, event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>
              <p className="mt-3 text-xs text-muted">也可拖放一份 PDF 到此处</p>
              {draft[role] && (
                <div className="mt-4 text-xs leading-relaxed">
                  <p className="break-all">{draft[role].name}</p>
                  <p className="text-muted">{formatBytes(draft[role].size)}</p>
                  <Button
                    className="mt-2"
                    disabled={busy}
                    onClick={() => {
                      remove(role);
                    }}
                  >
                    移除{role === 'primary' ? '主论文' : '补充材料'}
                  </Button>
                </div>
              )}
              {fileErrors[role] && (
                <p role="alert" className="mt-3 text-xs text-red-700">
                  {fileErrors[role]}
                </p>
              )}
            </section>
          );
        })}
      </div>
      <label className="mt-5 block text-sm">
        <span className="mb-2 block">项目名称</span>
        <input
          aria-label="项目名称"
          className={inputClass}
          value={draft.name}
          disabled={saving}
          placeholder="选择主论文后自动填写，可修改"
          onChange={(event) => change({ name: event.target.value, nameIsCustom: true })}
        />
      </label>
      <label className="mt-4 block text-sm">
        <span className="mb-2 block">
          汇报要求 <span className="text-xs text-muted">可选</span>
        </span>
        <textarea
          className={`${inputClass} resize-y leading-relaxed`}
          rows={3}
          value={draft.instruction}
          disabled={saving}
          placeholder="例如：中文组会，重点讲实验设计、主要发现与局限。"
          onChange={(event) => change({ instruction: event.target.value })}
        />
      </label>
      <p className="mt-2 text-xs text-muted">留空时使用论文主要语言，充分覆盖发现；要求不缩小全文解析范围。</p>
      {!modelReady && (
        <div className="mt-5 flex items-center justify-between rounded border border-line bg-panel p-3 text-xs">
          <span>尚未配置模型，可以先保存项目。</span>
          <Button disabled={busy} onClick={onSettings}>
            配置模型
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error} 文件选择和输入已保留，可重试。
        </p>
      )}
      <div className="mt-5 flex justify-end gap-3">
        <Button disabled={busy || !draft.primary || !draft.name.trim()} onClick={() => void save(false)}>
          {saving ? '正在保存…' : '保存，稍后开始'}
        </Button>
        <Button
          primary
          disabled={busy || !draft.primary || !draft.name.trim() || !modelReady}
          onClick={() => void save(true)}
        >
          开始分析
        </Button>
      </div>
      <p className="mt-4 text-xs text-muted">文件保存在当前浏览器；未提交的输入只在本次会话保留。</p>
    </ProjectDialog>
  );
}
