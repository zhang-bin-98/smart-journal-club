# 内容编辑、Agent 与撤销

> v0.5 目标设计，应用尚未实施；当前状态见 [执行目录](../execution/README.md)。

## 5. 修改、撤销与版本

### 内容提交与同步

论文、计划、文稿各自使用显式 mutation 与唯一提交入口，白名单决定范围；UI 只提出命令。请求包含 requestId、projectId、目标 ID/baseRevision 与有效任务。先在内存副本应用整批，验证结构/引用/范围/依赖，再在事务重读基准并一次写入数据与摘要，成功才推进内存、版本与历史。重复 requestId 拒绝。

计划编辑支持章节/讲述片段/页面的新增、更新、删除、重排及主线/补充调整，不保留 set-slide-budget 命令。移动章节带其页面与讲稿，跨章移动页面同时迁移相关片段；同批删除空章，禁止悬空 sectionId/speechIds。页间顺序由稳定锚点表示，null 为目标章首，拒绝不存在目标、自身后移或超范围变更。

正文手动删除与编辑不因比例、顺序等叙事建议被阻断；去掉页面同步去掉只属于该页的讲稿分配，论文发现保留，省略作为用户操作记录。纯过渡/空页不伪造 Claim，结果页仍不能引用不存在的证据。需要模型改写过渡或更新图文时先形成候选差异；新内容不会静默替换用户写过的文字或框。

应用与提案模拟复用相同验证；冲突、取消、并发和写入失败不推进 Current、revision、Undo 或历史。草稿第一次出现就使会覆盖它的任务失效，不等保存时才比较版本。未保存草稿阻止其他写入、导出和离开，保存失败保留输入；纯浏览不属于修改。

### 交互式 Agent

继续使用 pi-agent-core 现有 Agent、事件和 abort/hook 能力，实际 API 以 M10 锁定版本与实现为准，不重新编写通用 turn loop。提问只注册读工具；修改模式额外注册受控 proposal 工具。固定生成的首次内容创作由 workflow 授权，不能与“改写已有成果须应用提案”混为每页都要确认。

Deck 修改沿用 deck_propose_revision，扩展实际需要的讲稿/分配白名单；图源拖框通过应用的保存图源用例与 paper 内容入口，不能让 Deck tool 越权改 Paper。若图源需要模型重识别，使用显式 workflow 的当前 Figure 候选入口，不注册任意文件、bash、代码执行或通用 MCP 工具。

读工具保留 paper_get_overview、paper_get_claims、paper_get_figure、outline_get_structure、deck_get_slides；逐步纳入当前任务的原文片段和讲稿查询职责，参数从实际 Schema 派生。作用于旧稿时读取其绑定 Paper，不能混用当前工作底稿。工具不直接访问 IndexedDB 或承载事务。

明确目标 > UI 选择 > 近期上下文；“这页”绑定当前 slideId，多处 Figure 无法消歧才询问。section scope 展开为请求时的页面集合，新增内容不超出该章；讲稿 scope 跟随稳定片段/页面。只有全局请求带完整 Deck，普通局部请求带必要相邻页、讲稿与原文证据。

一次请求最多一个有效提案，写意图顺序执行，模拟后显示影响页/片段、差异和应用/放弃；应用时再次核对版本和范围。取消、Agent 后续失败、手工草稿、项目/Deck 切换使提案失效，不提供强制应用。每次应用是一条 RevisionRecord 和一次 Undo。

事件映射为可读进度，右侧显示对话/提案，底部输入共享同一状态；不显示隐藏推理、原始 JSON、provider 错误体或 Key。仅有限可见消息与已提交摘要持久化，刷新不恢复待应用权限。有限轮次/工具/上下文预算使用 Pi runtime 适配器的已有 hook，不建设 Node/SQLite backend。

### Undo/Redo 与 Current/Previous

各会话快照只存该内容域的必要数据，不含运行权限、旧 revision、原 PDF 或位图。Undo 恢复内容而 revision 递增；图源 Undo 也使核对失效，计划 Undo 回 draft。图源确认动作不作为可以恢复的生成授权。Undo 后新编辑清空 Redo，关闭项目/整套切版清空会话栈；失败不弹出快照。

生成后大纲与讲稿读取 Current 的 sections/speech/slides；不依赖已消费计划，也不维护独立可写副本。编辑 Current 走 DeckSession；需要规划重做时创建唯一候选计划。新 Deck 的结构、讲稿、论文绑定和 omissions 在成功应用时一笔事务切换，原 Current 成为 Previous，更早 Previous 只在不再被引用后回收。失败不覆盖旧版本。

恢复上一版原子交换 Current/Previous，成为 Current 的 revision 递增，绑定该版自己的论文与讲稿，失效旧任务、候选和会话 Undo。Project 工作底稿如与恢复稿不同，界面明确显示，不偷偷重绑或覆盖它；再次恢复可切回另一版。并发 Current 变更让候选 stale，不能绕过事务通过锁 UI“解决”。
