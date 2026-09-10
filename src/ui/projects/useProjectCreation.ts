import { useRef, useState } from 'react';
import { beginActivity, setDirty } from '../../app/activity';
import {
  clearCreationDraft,
  readCreationDraft,
  selectDraftFile,
  updateCreationDraft,
  type CreationDraft,
} from '../../app/projects/creationDraft';
import { createPreparedProject, validateProjectFile } from '../../app/projects/projectService';
import { errorMessage } from '../controls';

type FileRole = 'primary' | 'supplement';
export function useProjectCreation({
  modelReady,
  onCreated,
  onBusyChange,
}: {
  modelReady: boolean;
  onCreated: (id: string, start: boolean) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const [draft, setDraft] = useState(readCreationDraft);
  const [reading, setReading] = useState({ primary: false, supplement: false });
  const [fileErrors, setFileErrors] = useState({ primary: '', supplement: '' });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const activeReads = useRef(new Set<FileRole>());
  const committing = useRef(false);
  const busy = saving || reading.primary || reading.supplement;

  function change(changes: Partial<CreationDraft>) {
    setDraft(updateCreationDraft(changes));
    setDirty('project-creation', true);
  }
  async function choose(role: FileRole, files: FileList | File[]) {
    if (committing.current || activeReads.current.has(role)) return;
    if (files.length !== 1) {
      setFileErrors((previous) => ({ ...previous, [role]: '此处请选择一份 PDF。' }));
      return;
    }
    const file = files[0];
    const done = beginActivity();
    activeReads.current.add(role);
    setReading((previous) => ({ ...previous, [role]: true }));
    onBusyChange(true);
    setFileErrors((previous) => ({ ...previous, [role]: '' }));
    try {
      await validateProjectFile(file);
      setDraft(selectDraftFile(role, file));
      setDirty('project-creation', true);
    } catch (cause) {
      setFileErrors((previous) => ({ ...previous, [role]: errorMessage(cause) }));
    } finally {
      activeReads.current.delete(role);
      setReading((previous) => ({ ...previous, [role]: false }));
      onBusyChange(activeReads.current.size > 0);
      done();
    }
  }
  async function save(start: boolean) {
    if (committing.current || activeReads.current.size || !draft.primary || !draft.name.trim()) return;
    if (start && !modelReady) {
      setError('请先配置模型，或选择“保存，稍后开始”。');
      return;
    }
    committing.current = true;
    setSaving(true);
    onBusyChange(true);
    setError('');
    const done = beginActivity();
    let createdId: string | undefined;
    try {
      const project = await createPreparedProject({ ...draft, primary: draft.primary, name: draft.name.trim() });
      clearCreationDraft();
      setDirty('project-creation', false);
      createdId = project.id;
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      committing.current = false;
      setSaving(false);
      onBusyChange(false);
      done();
    }
    if (createdId) onCreated(createdId, start);
  }
  function remove(role: FileRole) {
    setDraft(selectDraftFile(role));
    setFileErrors((previous) => ({ ...previous, [role]: '' }));
  }
  return { draft, reading, fileErrors, error, saving, busy, change, choose, save, remove };
}
