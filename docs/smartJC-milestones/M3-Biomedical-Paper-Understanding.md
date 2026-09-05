# M3 — Biomedical Paper Understanding

> 目标：把 PDF 的确定性来源层转换成可验证的生物医学论文理解层。  
> 可演示结果：选择一篇真实论文 → 自动得到 StudyProfile、Figure、Claim–Evidence、PaperStory，并能点回原始来源。

---

## 1. 本里程碑的产品意义

smartJC 不是：

```text
PDF 摘句
→ 截图
→ PPT
```

而是：

```text
Paper Sources
→ Biomedical Understanding
→ Claim–Evidence
→ Story
```

M3 是产品差异化最强的一层。

---

## 2. 范围

### 必做

- 正式 OpenAI-compatible Provider Adapter；
- DeepSeek / GLM 固定 Preset；
- Pi Agent Core / Pi AI 的最小集成（用于分析阶段）；
- Prompt module 文件化；
- StudyProfile；
- 自动论文结构理解；
- 自动 Figure / Panel detection；
- Figure semantic description；
- Claim；
- Evidence；
- PaperStory / StoryPoint；
- Source mapping；
- Paper domain validation；
- Biomedical accuracy rules；
- 分阶段构建 Paper AST；
- 一个最小 Debug / Inspector 视图。

### 不做

- Deck Plan；
- 自动 Slide；
- Revision Agent；
- 完整 Chat UI；
- 通用 Provider 配置；
- 自定义 Base URL；
- 多 Agent；
- Prompt 管理平台。

---

## 3. Provider 正式化

M0 已做浏览器可行性验证。

M3 才建立正式：

```text
OpenAICompatibleProvider
├── DeepSeek preset
└── GLM preset
```

Provider 只负责：

- auth；
- request；
- stream；
- vision；
- structured / tool；
- abort；
- error normalization。

Provider 不知道：

- Paper；
- Figure；
- Deck。

---

## 4. Paper AST 构建必须分阶段

禁止一次模型调用输出一个巨大完整 Paper JSON。

推荐：

```text
PDF Parser
→ pages / sections / source candidates

Structure Analyzer
→ StudyProfile / high-level story

Vision Figure Analyzer
→ FigureRef / Panel / descriptions

Claim–Evidence Builder
→ claims / evidences

Story Builder
→ StoryPoint[]
```

最后由 Application Service 合并并验证。

---

## 5. StudyProfile

首版统一：

```text
primaryType:
mechanistic | omics | clinical | translational | mixed

secondaryTypes[]
species[]
tissues[]
cellTypes[]
cohorts[]
groups[]
modalities[]
interventions[]
endpoints[]
confidence
```

不要创建：

```text
MechanisticPaper
OmicsPaper
ClinicalPaper
```

不同 class。

---

## 6. Figure Detection

输入：

```text
中分辨率 PDF Page Image
+
必要 page text
```

模型输出：

```text
Figure label
bbox
Panel bbox
caption relation
short description
```

写入前：

1. Zod parse；
2. bbox validation；
3. page validation；
4. Figure / Panel SourceReference 创建；
5. domain validation。

自动识别失败不应破坏手工 M2 能力。

用户未来修正的 `manuallyAdjusted=true` 必须高于重新检测结果。

---

## 7. Claim–Evidence

### Claim

至少包含：

```text
text
category
strength
evidenceIds
importance
```

强度最少：

```text
descriptive
associative
supportive
causal
```

### Evidence

至少支持：

```text
observational
association
omics
spatial
perturbation
rescue
animal
clinical
external-validation
statistical
methodological
```

Evidence 必须回到：

```text
sourceIds
figureIds
supportsClaimIds
```

---

## 8. Biomedical 硬规则

这些规则不能只存在于 Prompt。

至少在 domain validator / review validator 中保护：

- association 不自动升级 causation；
- pseudotime 不等于真实 chronological time；
- human / animal evidence 不混写；
- gene expression / protein evidence 不混写；
- 未提供的精确统计数字不可生成；
- Figure source 必须属于当前 Paper；
- group / cohort / species 不能随意重命名。

无法纯代码判断的规则：

```text
Prompt
+
structured metadata
+
model-assisted review
```

共同处理。

---

## 9. PaperStory

高层故事点使用：

```text
StoryPoint {
  text
  claimIds
  sourceIds
}
```

不要重新退化成无来源 `string[]`。

至少覆盖：

- background；
- knowledge gap；
- research question；
- study design；
- main findings；
- novelty；
- conclusion；
- limitations。

---

## 10. Debug / Inspector

M3 不需要正式用户 UI，但需要开发检查面板：

```text
StudyProfile
Claims
Evidence
Figures
Story
```

点击任何 Claim / Figure 可打开 Source Preview。

目的：

> 让开发者能人工判断 Paper AST 是否可信。

不要建设完整“知识图谱 UI”。

---

## 11. Golden Papers

从 M3 开始固定维护三篇真实回归论文：

```text
golden-mechanistic.pdf
golden-omics.pdf
golden-clinical-or-translational.pdf
```

如果版权 / 仓库存储不适合直接提交 PDF，可保存本地 fixture 管理说明与结构化期望文件。

M3 验收至少确认：

### Mechanistic

- phenotype；
- perturbation / rescue；
- mechanism；
- 因果强度。

### Omics

- sample / modality；
- cell state / biological program；
- 不把工具流水线当故事。

### Clinical / Translational

- population；
- group；
- endpoint；
- main outcome；
- human / experimental evidence 分层。

---

## 12. 测试

### Contract

- valid Paper parses；
- invalid bbox rejected；
- missing source rejected；
- bad claim/evidence link rejected；
- bad figure/panel relation rejected。

### Integration

至少：

```text
PDF
→ parse
→ provider analysis
→ validated Paper AST
→ persist
→ reopen
→ source trace
```

不要追求“LLM 输出每次完全一致”的字符串测试。

---

## 13. Definition of Done

- [ ] 两个 Provider 通过统一 Adapter 接入（若 M0 已明确只能保留一个，则按 M0 决策）；
- [ ] Paper AST 分阶段构建；
- [ ] 能自动识别主要 Study Type；
- [ ] 能识别主要 Figure / Panel 并保存 bbox；
- [ ] 每个主要 Figure 可回到 Source；
- [ ] 能生成主要 Claim / Evidence；
- [ ] 主要 Claim 有来源；
- [ ] PaperStory 带 claim/source 引用；
- [ ] Biomedical 硬规则有可执行校验或明确 review 层；
- [ ] 三类 Golden Paper 均完成人工评估；
- [ ] 失败结果不会覆盖已有稳定 Paper 数据；
- [ ] 未开始建设 Deck Planner / Revision Agent。

---

## 14. 下一里程碑入口

M4 将只消费已经验证的：

```text
StudyProfile
Claim
Evidence
Figure
PaperStory
GenerationPreferences
```

来规划 Deck。

如果 M4 发现需要重新阅读大量原始全文才能决定每页内容，说明 M3 的 Paper AST 信息不足，应回到 M3 补最小必要字段，而不是让 Deck Planner 重新发明论文理解层。
