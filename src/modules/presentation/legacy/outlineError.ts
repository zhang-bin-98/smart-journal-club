/** 可预期的大纲失败只暴露产品信息；详细校验条目由对应 validator 提供。 */
export class OutlineError extends Error {
  readonly stage = 'outline';
  constructor(
    readonly code: string,
    message: string,
    readonly recovery = '返回学术大纲检查并重试。',
  ) {
    super(message);
  }
}
