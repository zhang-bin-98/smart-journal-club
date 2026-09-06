import { Agent, type AgentOptions } from '@earendil-works/pi-agent-core';

/**
 * 统一创建交互式 Agent；工具执行、事件订阅和取消由 pi-agent-core 管理。
 * 业务层只负责提供初始上下文与受控工具，不在此维护轮次状态。
 */
export function createAssistantAgent(options: AgentOptions) {
  return new Agent({
    ...options,
    toolExecution: options.toolExecution ?? 'sequential',
  });
}
