export class ModelError extends Error {
  readonly recovery = '检查模型设置或返回当前步骤重试。';
  constructor(
    public readonly stage: string,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** 仅供固定 workflow 修复，不将原始结果作为 UI 错误消息。 */
export class ModelOutputError extends ModelError {
  constructor(
    stage: string,
    readonly failedOutput: unknown,
    readonly diagnostics: { code: string; path: string; message: string }[],
  ) {
    super(stage, 'invalid-output', '模型输出不符合本阶段数据要求，最近保存的成果仍保留，请重试。');
  }
}
