# M4 — Initial Generation Vertical Slice

> 目标：第一次完成 smartJC 的核心用户价值闭环。  
> 可演示结果：上传一篇生物医学原创研究论文 → 输入一句要求 → 自动生成约 10–20 页 PPT → Preview → Source → Export。

---

## 1. 这是 Alpha 里程碑

M4 完成后，产品第一次具备真实使用价值。

完整主链：

```text
Create Project
↓
Persist PDF
↓
Parse
↓
Understand Paper
↓
Analyze Figures
↓
Build Claim–Evidence
↓
Plan Story
↓
Build Deck
↓
Validate
↓
Commit
↓
Preview / Export
```

大纲存在于内部，但不强制用户确认。

---

## 2. 范围

### 必做

- GenerationPreferences；
- GenerationCoordinator；
- 高层 Generation UI；
- Story Strategy；
- DeckPlan；
- PlannedSlide；
- Slide budget；
- Initial slide writing；
- Figure selection；
- Deck building；
- Working Deck；
- 自动质量检查；
- Commit；
- 初始生成后进入 Project Editor；
- Source Preview 与已有 M2 能力接通；
- Export；
- 生成失败不污染稳定 Project；
- 基础取消能力。

### 不做

- Revision Agent；
- 多轮 Chat；
- 复杂 Undo history；
- 整套 Regenerate UI；
- Drag / Resize；
- Project Backup；
- 通用 Workflow Framework。

---

## 3. GenerationPreferences

创建项目只保留一个自然语言输入。

内部可解析：

```text
rawInstruction
language
targetSlides
presentationMinutes
audience
focus[]
presentationType
```

如果解析不可靠：

```text
保留 rawInstruction
```

不要为了这些字段增加复杂创建表单。

默认：

- 论文主语言；
- 约 12–16 页；
- 15–25 min Journal Club；
- Results 占最大比例；
- Figure 优先；
- 方法只保留理解结果所需内容。

---

## 4. Story Strategy

首版只实现四个内部策略：

```text
mechanistic
omics
clinical
translational / mixed
```

不是用户模板。

### Mechanistic

重点：

```text
phenotype
→ molecular change
→ mechanism
→ perturbation / rescue
→ validation
```

### Omics

重点：

```text
biological question
→ sample / modality
→ global landscape
→ key state / feature
→ biological program
→ cross-modal / spatial / interaction evidence
→ validation
```

禁止默认：

```text
QC → UMAP → DEG → Enrichment → CellChat
```

### Clinical

重点：

```text
population
→ design
→ primary endpoint
→ main outcome
→ secondary / sensitivity
→ interpretation
```

### Translational

围绕同一 Claim 串联：

```text
Human
→ Omics
→ Experimental
→ Validation
→ Implication
```

---

## 5. DeckPlan

DeckPlan 至少：

```text
targetSlides
strategy
sections
slides[]
```

每个 PlannedSlide：

```text
type
message
claimIds
evidenceIds
figureSelections
layoutId
```

原则：

> DeckPlan 决定“讲什么、为什么、用什么证据”，Deck AST 决定“页面里有什么”。

---

## 6. Slide 规划规则

### One Slide, One Message

每个结果页必须能回答：

```text
这页要让听众记住什么？
```

### Figure-first

结果页优先结构：

```text
结论句标题
主要 Figure / Panel
1–3 个短点
Source
```

### Results-first

压缩优先级：

```text
次要背景
→ 非关键方法
→ 次要 / 重复 evidence
→ discussion 延伸
```

核心结果最后才压缩。

### 可读性

拥挤时：

```text
拆页
>
删减非核心文字
>
换 Layout
>
减少 Figure
```

不允许无限缩小字体。

---

## 7. Working Deck

初始生成必须：

```text
Working Deck
→ validate
→ Current Deck
```

生成中不得逐页覆盖用户当前稳定 Deck。

首次项目尚无 Current Deck 时，也不要把非法半成品标记为 Ready。

---

## 8. Validation

Commit 前至少运行：

```text
Schema Validation
Domain Validation
Source Integrity
Duplicate Slide Check
Empty Slide Check
Layout Check
Language Consistency
Core Claim Coverage
```

其中：

- 硬引用错误 → error；
- 页面略长 / figure 略小 → warning；
- Core Claim Coverage 可使用模型辅助 review。

---

## 9. Generation UI

只展示高层阶段：

```text
✓ 解析论文
✓ 理解研究内容
● 分析 Figures
○ 规划汇报结构
○ 制作幻灯片
```

不要显示：

- raw Tool Call；
- token；
- hidden reasoning；
- provider protocol。

提供：

```text
取消
```

取消后保留已完成稳定 Artifact。

完整 Checkpoint 恢复放 M6，但 M4 至少不能把 Project 删除或污染。

---

## 10. 首次完成后的 Editor

生成成功：

```text
Generating
→ Project Editor
```

Editor 此时至少有：

- Slide Navigator；
- Preview；
- inline text edit（来自 M1）；
- slide reorder；
- Source Preview；
- Figure crop；
- Undo / Redo（手工操作基础能力）；
- Export。

右侧 Agent Chat 可以先是占位或隐藏，M5 再开放。

---

## 11. Alpha 验收场景

使用三类 Golden Paper，分别执行：

```text
上传
→ 可选一句生成要求
→ Generate
→ 自动完成
→ 浏览所有 Slides
→ 查看至少 3 个 Figure Source
→ 手工修正一个 crop
→ reorder
→ Export PPTX
```

每篇至少人工评估：

- 主要问题识别是否正确；
- Results 是否占核心；
- 主要 Claim 是否覆盖；
- Figure 是否支持对应标题；
- 复杂 Figure 是否合理拆分；
- 组别 / cohort / species 是否正确；
- observation / causation 是否被错误升级；
- 是否明显幻觉；
- Figure 是否可读；
- PPTX 是否可打开。

---

## 12. Definition of Done

- [ ] 用户可从 Home 上传 PDF 并创建 Project；
- [ ] 一个自然语言生成要求可以被消费；
- [ ] 无需中途确认大纲；
- [ ] 系统可一路自动得到完整 Deck；
- [ ] 默认约 10–20 页，并根据论文复杂度调整；
- [ ] Results 为主要篇幅；
- [ ] Result slide 多数使用结论句标题；
- [ ] 主要 Claim 具有 source；
- [ ] Figure / Panel source 可查看；
- [ ] Source crop 可手工修正；
- [ ] Deck 通过基本质量校验后才 commit；
- [ ] Export PPTX 可用；
- [ ] 三类 Golden Paper 均能跑通；
- [ ] 失败不会留下非法 Current Deck；
- [ ] 未引入 Revision Agent。

---

## 13. M4 完成后的产品状态

可以标记为：

> **Internal Alpha**

此时最值得做的是拿真实论文反复试用，记录：

- Figure detection 错误；
- Paper understanding 错误；
- Story planning 错误；
- Layout 可读性问题。

不要马上开始增加非核心功能。

---

## 14. 下一里程碑入口

M5 只解决：

> 已经有一套可用 Deck 后，用户如何用自然语言和少量直接编辑继续修改。

M5 不应重新设计初始生成流程。
