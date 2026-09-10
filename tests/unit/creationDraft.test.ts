import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCreationDraft,
  readCreationDraft,
  selectDraftFile,
  updateCreationDraft,
} from '../../src/app/projects/creationDraft';

describe('项目新建会话', () => {
  beforeEach(clearCreationDraft);

  it('保留两份实际文件与输入，重新读取会话不将文件转换为信息副本', () => {
    const primary = new File(['%PDF-1.7 primary'], 'paper.pdf');
    const supplement = new File(['%PDF-1.7 supplement'], 'support.pdf');
    selectDraftFile('primary', primary);
    selectDraftFile('supplement', supplement);
    updateCreationDraft({ instruction: '中文组会', name: '研究汇报', nameIsCustom: true });
    const resumed = readCreationDraft();
    expect(resumed.primary).toBe(primary);
    expect(resumed.supplement).toBe(supplement);
    expect(resumed.name).toBe('研究汇报');
    expect(resumed.instruction).toBe('中文组会');
  });

  it('更换主论文只更新自动名称，不覆盖人工名称或补充文件', () => {
    const supplement = new File(['%PDF-1.7'], 'support.pdf');
    selectDraftFile('supplement', supplement);
    selectDraftFile('primary', new File(['%PDF-1.7'], 'first.pdf'));
    expect(readCreationDraft().name).toBe('first');
    updateCreationDraft({ name: '人工名称', nameIsCustom: true });
    selectDraftFile('primary', new File(['%PDF-1.7'], 'second.pdf'));
    expect(readCreationDraft().name).toBe('人工名称');
    expect(readCreationDraft().supplement).toBe(supplement);
    selectDraftFile('primary');
    expect(readCreationDraft().name).toBe('人工名称');
  });

  it('仅成功提交路径显式清空会话，读取快照不会改变原草稿', () => {
    selectDraftFile('primary', new File(['%PDF-1.7'], 'paper.pdf'));
    const snapshot = readCreationDraft();
    snapshot.name = '意外改动';
    expect(readCreationDraft().name).toBe('paper');
    expect(clearCreationDraft()).toEqual({ name: '', instruction: '', nameIsCustom: false });
  });
});
