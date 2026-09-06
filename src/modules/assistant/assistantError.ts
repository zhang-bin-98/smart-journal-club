export class AssistantError extends Error {
  readonly stage = 'assistant';
  readonly recovery = '请基于当前文稿重新发起请求。';
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
