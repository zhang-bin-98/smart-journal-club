export type CreationDraft = {
  primary?: File;
  supplement?: File;
  name: string;
  nameIsCustom: boolean;
  instruction: string;
};

const emptyDraft = (): CreationDraft => ({ name: '', nameIsCustom: false, instruction: '' });
let draft = emptyDraft();

/** 创建会话仅留在内存，保留真实 File；保存失败、关闭弹窗或进入设置不会清空。 */
export function readCreationDraft(): CreationDraft {
  return { ...draft };
}

export function updateCreationDraft(changes: Partial<CreationDraft>): CreationDraft {
  draft = { ...draft, ...changes };
  return readCreationDraft();
}

export function clearCreationDraft(): CreationDraft {
  draft = emptyDraft();
  return readCreationDraft();
}

export function selectDraftFile(role: 'primary' | 'supplement', file?: File): CreationDraft {
  return updateCreationDraft({
    [role]: file,
    ...(role === 'primary' && !draft.nameIsCustom ? { name: file?.name.replace(/\.pdf$/i, '') ?? '' } : {}),
  });
}
