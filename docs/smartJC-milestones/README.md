# smartJC 里程碑执行总览

> 项目：smartJC  
> 范围：面向生物医学原创研究论文的 Local-first、Workflow-first、Agent-assisted PDF → PPT PWA  
> 用途：将当前产品文档与架构文档转化为可直接交给开发 Agent 执行的阶段计划。  
> 原则：每个里程碑都必须产生可运行、可演示、可验收的增量；不按“先把所有基础设施建完”推进。

---

## 1. 总体目标

smartJC 的 MVP 最终闭环：

```text
上传生物医学原创研究论文 PDF
        ↓
输入一句可选生成要求
        ↓
自动解析论文、理解研究、分析 Figure
        ↓
生成完整科研汇报 Deck
        ↓
浏览器预览 + Source Preview
        ↓
自然语言 / 少量直接编辑持续修改
        ↓
Undo / 恢复
        ↓
导出可继续编辑的 PPTX
```

首版不建设：

- 通用 Web Agent；
- Shell / MCP / Plugin Marketplace；
- 云端项目后端；
- 多人协作；
- 完整 PowerPoint Clone；
- Review 论文专用工作流；
- 任意 Provider / Model 配置平台；
- 复杂版本树或 Event Sourcing。

---

## 2. 里程碑总览

| 里程碑 | 名称 | 核心问题 | 可演示结果 | 是否阻塞 MVP |
|---|---|---|---|---|
| M0 | 技术路线 Spike | 浏览器直连模型、PDF、PPTX 路线是否成立？ | 三个独立 PoC + 结论 | 是 |
| M1 | Deck Kernel | 能否稳定表示、渲染、修改、导出 Deck？ | 静态 JSON Deck → Web Preview → PPTX | 是 |
| M2 | Project / PDF / Source Core | 能否把论文及来源可靠地本地化、追溯和裁图？ | 上传 PDF → 本地项目 → Source Preview / Crop | 是 |
| M3 | Biomedical Paper Understanding | 能否得到可信的 Paper AST、Claim–Evidence 和 Figure 语义？ | PDF → 可验证 Paper AST | 是 |
| M4 | Initial Generation Vertical Slice | 能否端到端自动生成一套可用科研 PPT？ | PDF → 10–20 页 Deck → PPTX | 是 |
| M5 | Revision Agent + Editor | 能否通过自然语言局部、安全、可撤销地修改 Deck？ | “这页太挤 / Fig.3 只留 B,D” 等可执行 | 是 |
| M6 | Recovery / Quality / MVP Release | 能否在刷新、失败、切模型和真实论文中稳定工作？ | 可恢复、可回归、可发布 MVP | 是 |
| M7 | P1 可用性增强（条件触发） | 真实试用是否证明需要更自由编辑/迁移？ | Drag / Resize、Project Backup 等 | 否 |

---

## 3. 推荐依赖关系

```text
M0
 ↓
M1
 ↓
M2
 ↓
M3
 ↓
M4
 ↓
M5
 ↓
M6
 ↓
M7（仅在真实需求触发后）
```

虽然部分任务可以并行探索，但正式主干代码应尽量按此顺序合并，避免上游契约尚未稳定就提前建设 Agent 和恢复系统。

---

## 4. 每个里程碑统一执行规则

### 4.1 开始前

执行 Agent 必须：

1. 阅读当前用户需求；
2. 阅读 `产品文档.md`；
3. 阅读 `架构文档.md`；
4. 阅读当前里程碑文档；
5. 检查现有代码与未提交改动；
6. 只打开与本里程碑直接相关的模块。

### 4.2 复用优先

新增重要依赖、算法或运行机制前，依次检查：

```text
现有项目代码
→ Pi 官方包 / 示例
→ 已选依赖官方能力
→ 成熟浏览器库
→ 薄 Adapter
→ 最后才自研
```

不要因为“以后可能需要”而提前建设通用框架。

### 4.3 最小实现

每个任务优先实现：

> 能通过当前里程碑验收的最短路径。

禁止借当前里程碑：

- 重构无关模块；
- 添加未来目录和空接口；
- 建第二套实现只为了证明抽象；
- 引入通用 Workflow Framework；
- 引入 Plugin Manager；
- 引入大规模状态管理基础设施；
- 扩大测试矩阵。

### 4.4 测试原则

只写与当前新增风险直接相关的测试。

必须长期保护的核心契约：

```text
Paper AST
SourceReference
Claim / Evidence
Deck AST
RevisionTransaction
Checkpoint / Persistence Contract
```

普通 UI 文案和低风险样式不追求高覆盖率。

### 4.5 完成汇报

每个里程碑结束时至少记录：

```text
完成了什么
没有做什么
复用了什么
验收命令 / 手工验证结果
尚存风险
是否满足进入下一里程碑的 Gate
```

---

## 5. Core Contract 冻结节奏

不是所有 Schema 从第一天永久冻结。

推荐：

```text
M1 结束
→ Deck AST / Layout / Mutation 基本冻结

M2 结束
→ Project / SourceReference / FigureRef / Persistence 基本冻结

M3 结束
→ Paper AST / Claim / Evidence / StudyProfile 基本冻结

M5 结束
→ RevisionTransaction / Agent Tool Contract 基本冻结

M6
→ 只允许兼容性修正，不再做大范围领域模型改造
```

Prompt、Story Strategy、默认页数、Theme、布局细节和 UI 文案可以持续迭代。

---

## 6. 版本定义

### Alpha：M4 完成

第一次形成真实纵向闭环：

```text
PDF
→ 自动理解
→ 自动生成 Deck
→ Preview
→ PPTX
```

此时可以开始内部真实论文试用。

### Beta：M5 完成

加入：

```text
自然语言 Revision
+
手工编辑
+
Undo / Redo
```

产品核心体验完整。

### MVP Release Candidate：M6 完成

加入：

```text
Checkpoint / Recovery
Provider Failure Handling
Golden Paper 回归
错误体验
PWA / 本地持久化硬化
```

满足公开试用条件。

---

## 7. M7 的进入条件

M7 不自动开始。

只有 M6 后真实试用出现以下证据之一才进入：

- 模板布局无法覆盖主要用户场景，用户频繁要求手工拖动；
- 用户确实需要跨浏览器 / 设备迁移项目；
- Theme 切换已经成为高频需求；
- 现有编辑器明显限制继续使用。

否则保持 MVP 简洁，优先修复生成质量、Figure 识别和科研准确性。
