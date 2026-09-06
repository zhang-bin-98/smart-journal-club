import { useEffect, useId, useRef, useState } from 'react';
import type { ModelSettings } from '../../shared/llm/model';
import type { ChatMessage } from '../../modules/assistant/assistant.schema';
import type { Paper } from '../../modules/paper/paper.schema';
import type { Project } from '../../modules/project/project.schema';
import type { PersistAssistantRevision } from '../../modules/assistant/revision/applyRevision';
import type { DeckSession } from '../../modules/deck/DeckSession';
import { runAiRevision } from '../../modules/assistant/runtime/runAssistant';
import { applyProposal, type PendingRevision } from '../../modules/assistant/revision/applyProposal';
import { resolveAiTarget, type AiTarget, type AssistantScope } from '../../modules/assistant/target/resolveTarget';
import { loadHistory } from '../../modules/assistant/conversationRepository';
import { beginActivity, setDirty } from '../../app/activity';
import { errorMessage, useOnline } from '../controls';
import type { CancelAi } from './AiPanel';

/** AI 助手面板控制器：输入、历史加载、请求任务与取消；runtime 编排仍在 modules/assistant。 */
export function useAssistantController({
  session,
  paper,
  settings,
  projectId,
  preferences,
  persistRevision,
  selectedSlideId,
  selectedElementId,
  onChanged,
  beforeSend,
  beforeUndo,
  onBusyChange,
  registerCancel,
  disabled = false,
}: {
  disabled?: boolean;
  session: DeckSession;
  paper: Paper;
  settings: ModelSettings;
  projectId?: string;
  preferences?: Project['preferences'];
  persistRevision?: PersistAssistantRevision;
  selectedSlideId?: string;
  selectedElementId?: string;
  onChanged: () => void;
  beforeSend: () => Promise<void>;
  beforeUndo: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  registerCancel: (cancel?: CancelAi) => void;
}) {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<'answer' | 'revision'>('answer');
  const [scope, setScope] = useState<AssistantScope>('slides');
  const [proposal, setProposal] = useState<PendingRevision>();
  const proposalRef = useRef<PendingRevision | undefined>(undefined);
  const [progress, setProgress] = useState('');
  const [streamedText, setStreamedText] = useState('');
  const [boundTarget, setBoundTarget] = useState<AiTarget>();
  const binding = useRef<{ deckId: string; revision: number } | undefined>(undefined);
  const online = useOnline();
  const inputKey = useId();
  const changeInput = (value: string) => {
    setDirty(inputKey, !!value.trim());
    setInput(value);
  };
  useEffect(() => () => setDirty(inputKey, false), [inputKey]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingMessage, setPendingMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(!!projectId);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const task = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const messageList = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 项目或会话切换必须取消旧任务
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      task.current?.abort();
      task.current = undefined;
      registerCancel();
      onBusyChange(false);
    };
  }, [registerCancel, onBusyChange, projectId, session]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 仅文稿版本变化使已绑定任务失效，选择变化不取消
  useEffect(() => {
    const base = binding.current;
    if (base && (session.current.id !== base.deckId || session.current.revision !== base.revision)) cancel('manual');
  }, [session.current.id, session.current.revision]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: historyAttempt 驱动读取失败后的手动重试
  useEffect(() => {
    let active = true;
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setHistoryError('');
    loadHistory(projectId).then(
      (saved) => {
        if (active) {
          setMessages(saved);
          setLoading(false);
        }
      },
      (cause) => {
        if (active) {
          setHistoryError(errorMessage(cause));
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [projectId, historyAttempt]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖即触发条件，消息或状态变化时滚动到底部
  useEffect(() => {
    messageList.current?.scrollTo({ top: messageList.current.scrollHeight });
  }, [messages, pendingMessage, busy, error, streamedText, proposal]);
  function cancel(reason?: 'manual') {
    const controller = task.current;
    if (!controller) return false;
    task.current = undefined;
    binding.current = undefined;
    proposalRef.current = undefined;
    setProposal(undefined);
    setBoundTarget(undefined);
    setStreamedText('');
    controller.abort();
    registerCancel();
    setBusy(false);
    onBusyChange(false);
    setPendingMessage('');
    setNotice(reason === 'manual' ? '' : '已取消本次请求');
    return true;
  }
  async function send() {
    const request = input.trim();
    if (!request || busy || loading || historyError || disabled || !online) return;
    if (task.current) cancel();
    if (!settings.apiKey.trim()) {
      setError('请先在模型设置中配置 API Key。');
      return;
    }
    const done = beginActivity();
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setNotice('');
    setStreamedText('');
    setProgress('正在分析');
    try {
      await beforeSend();
      if (!mounted.current || task.current !== controller || controller.signal.aborted) return;
      registerCancel(cancel);
      changeInput('');
      setPendingMessage(request);
      const target = resolveAiTarget(
        request,
        session.current,
        paper,
        selectedSlideId,
        selectedElementId,
        messages,
        scope,
      );
      setBoundTarget(target);
      binding.current = { deckId: session.current.id, revision: session.current.revision };
      const result = await runAiRevision({
        settings,
        paper,
        deck: session.current,
        session,
        projectId,
        preferences,
        request,
        mode,
        target,
        selectedSlideId,
        selectedElementId,
        onProgress: (value) => {
          if (!mounted.current || task.current !== controller || controller.signal.aborted) return;
          setProgress(value.status);
          if (value.text !== undefined) setStreamedText(value.text);
        },
        recentMessages: messages,
        signal: controller.signal,
        isTaskActive: () => mounted.current && task.current === controller,
      });
      if (!mounted.current || task.current !== controller || controller.signal.aborted) return;
      setMessages((value) =>
        [
          ...value.filter((message) => !result.messages.some((next) => next.id === message.id)),
          ...result.messages,
        ].slice(-100),
      );
      proposalRef.current = result.proposal;
      setProposal(result.proposal);
      setStreamedText('');
    } catch (cause) {
      if (mounted.current && task.current === controller && !controller.signal.aborted) {
        setError(errorMessage(cause));
        changeInput(request);
      }
    } finally {
      done();
      if (mounted.current && task.current === controller) {
        if (!proposalRef.current) {
          task.current = undefined;
          binding.current = undefined;
          setBoundTarget(undefined);
          registerCancel();
        }
        setBusy(false);
        onBusyChange(false);
        setPendingMessage('');
      }
    }
  }
  async function apply() {
    const current = proposalRef.current;
    const controller = task.current;
    if (!current || !controller || busy || disabled) return;
    const done = beginActivity();
    setBusy(true);
    onBusyChange(true);
    setError('');
    setProgress('正在应用');
    try {
      await beforeSend();
      const result = await applyProposal({
        proposal: current,
        session,
        paper,
        signal: controller.signal,
        isTaskActive: () => mounted.current && task.current === controller && proposalRef.current === current,
        persistRevision,
      });
      if (!mounted.current) return;
      proposalRef.current = undefined;
      setProposal(undefined);
      binding.current = undefined;
      setMessages((value) => [...value, ...result.messages].slice(-100));
      onChanged();
    } catch (cause) {
      if (mounted.current && task.current === controller && !controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      done();
      if (mounted.current && task.current === controller) {
        task.current = undefined;
        binding.current = undefined;
        proposalRef.current = undefined;
        setProposal(undefined);
        setBoundTarget(undefined);
        registerCancel();
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  function canUndo(message: ChatMessage) {
    return (
      message.revision !== undefined &&
      message.deckId === session.current.id &&
      message.revision === session.current.revision &&
      session.canUndo
    );
  }
  async function undoRevision(message: ChatMessage) {
    if (busy || disabled || !canUndo(message)) return;
    cancel('manual');
    const done = beginActivity();
    try {
      await beforeUndo();
      if (!canUndo(message)) return;
      await session.undo();
      onChanged();
      setError('');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      done();
    }
  }
  return {
    mode,
    setMode,
    scope,
    setScope,
    proposal,
    apply,
    progress,
    streamedText,
    target:
      boundTarget ??
      resolveAiTarget(input, session.current, paper, selectedSlideId, selectedElementId, messages, scope),
    online,
    messages,
    pendingMessage,
    busy,
    loading,
    historyError,
    setHistoryAttempt,
    error,
    notice,
    input,
    changeInput,
    send,
    cancel,
    canUndo,
    undoRevision,
    messageList,
  };
}
