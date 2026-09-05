# M6 — Recovery / Quality / MVP Release

> 目标：把“能跑的 Beta”变成“出现失败也不轻易丢工作、可以用真实论文持续回归”的 MVP。  
> 原则：M6 是硬化，不是扩功能。

---

## 1. 范围

### 必做

- Stable Checkpoint；
- Generation resume；
- Cancellation 完整化；
- Provider switch；
- Reanalyze Paper / Regenerate Deck 语义分离；
- Current / Working / Previous Major Deck；
- Regenerate failure protection；
- persistent storage request；
- degraded Project；
- PDF reattach；
- Figure cache rebuild；
- Error Model；
- User-facing recovery actions；
- PWA offline boundary；
- Golden Paper 端到端回归；
- PPTX 导出验证；
- 性能 / 大 PDF 最小硬化；
- 发布文案与隐私说明。

### 不做

- 多版本树；
- 云同步；
- 后端任务队列；
- 多人协作；
- 通用 Event Sourcing；
- 任意 Provider；
- Drag / Resize（除非真实 Beta 证明为 blocker）；
- Project Backup（默认放 M7）。

---

## 2. Stable Checkpoint

正式支持：

```text
project-created
pdf-parsed
paper-ready
figures-ready
deck-plan-ready
deck-ready
```

原则：

> 只有整个阶段完全成功后，Checkpoint 才前进。

恢复依据：

```text
Checkpoint
+
Artifact existence
```

而不是仅靠 `status`。

---

## 3. Artifact 对应关系

```text
project-created
→ Project + Original PDF

pdf-parsed
→ Pages / Sections / Sources

paper-ready
→ StudyProfile + Story + Claim + Evidence

figures-ready
→ FigureRef + Panels

deck-plan-ready
→ DeckPlan

deck-ready
→ Current Deck
```

如果某阶段结果不完整：

```text
不要更新 checkpoint
```

---

## 4. Resume

示例：

```text
checkpoint = figures-ready
```

重新打开：

```text
Story / Deck Planning
→ Deck Generation
```

不得重跑：

- PDF parse；
- 已完成 Figure detection。

Resume 前检查：

- PDF 是否存在；
- Provider 是否配置；
- Artifact schema 是否有效。

不自动发起模型调用，先给用户恢复入口。

---

## 5. Deck 三态

只保留：

```text
Current Deck
Working Deck
Previous Major Deck
```

不建设版本树。

### Regenerate Deck

```text
Current
→ save Previous Major
→ build Working
→ validate
→ success: Working → Current
→ fail: discard Working
```

失败时当前版本必须保持可用。

---

## 6. Reanalyze vs Regenerate

### Reanalyze Paper

更新：

```text
StudyProfile
Story
Claims
Evidence
Figure interpretation（必要时）
```

现有 Deck 保留。

### Regenerate Deck

使用当前 Paper AST 重新：

```text
Plan
→ Deck
```

不重新 parse PDF。

Provider switch 本身既不 Reanalyze，也不 Regenerate。

---

## 7. Provider Failure

场景：

```text
DeepSeek rate limit
→ switch GLM
→ continue from checkpoint
```

允许不同 Artifact 来自不同 Provider。

Provider provenance 只用于 debug，不成为科学来源。

---

## 8. Degraded Project

至少支持：

```text
missingPdf
missingAssets[]
```

PDF 缺失时尽量仍可：

- 打开已有 Deck；
- 编辑文本；
- 查看已有 Paper AST；
- 使用完整缓存时导出。

受限：

- Source Preview；
- 新 crop；
- 页面 vision；
- 从 PDF 重建 cache。

---

## 9. Reattach PDF

重新绑定前进行身份检查：

```text
fingerprint
page count
title
DOI
text signature
```

明显不同：

```text
拒绝覆盖
→ 提示创建新 Project
```

不要静默让旧 SourceReference 指向新论文。

---

## 10. Storage

尽量请求浏览器 Persistent Storage。

UI 明确提示：

> 项目保存在当前浏览器。清除站点数据可能删除本地项目。

如果 storage write 失败：

- 不显示 Saved；
- 尽量保留内存态；
- 明确告诉用户不要关闭页面；
- 区分 quota / generic write error。

---

## 11. Error Model

至少：

```text
PDF_PARSE_ERROR
PDF_MISSING
MODEL_AUTH_ERROR
MODEL_RATE_LIMIT
MODEL_QUOTA
MODEL_CONTEXT_LIMIT
MODEL_OUTPUT_INVALID
VISION_ANALYSIS_FAILED
FIGURE_RENDER_FAILED
SOURCE_INVALID
DECK_VALIDATION_FAILED
PPTX_EXPORT_FAILED
STORAGE_QUOTA
STORAGE_WRITE_FAILED
```

错误对象包含：

```text
stage
recoverable
checkpoint
```

UI 必须回答：

```text
哪里失败？
什么已经保存？
下一步能做什么？
```

---

## 12. Offline Boundary

无网络可：

- 打开项目；
- 看 Deck；
- 手工改已有内容；
- reorder；
- cache 可用时看 Figure；
- 资源完整时导出。

无网络不可：

- Agent；
- Reanalysis；
- Vision；
- 需要模型的 Regenerate。

不需要为了 Offline 建第二套逻辑。

---

## 13. 大 PDF / 性能

只做测量驱动优化：

### PDF

- lazy render；
- high DPI on demand；
- dispose canvas；
- cache figure bitmap。

### Deck

- 只全量渲染当前 Slide；
- thumbnails 降采样；
- revision 后只刷新受影响 Slide。

### Model

- 不发全文；
- 使用 Paper AST；
- targeted source / figure；
- revision minimal context。

如果性能仍不足，再记录下一阶段技术触发条件，不预先引入 Worker 大拆分。

---

## 14. Golden Paper Release Gate

三类真实论文全部跑完整闭环：

```text
upload
→ generate
→ inspect sources
→ revise
→ crop
→ reorder
→ undo
→ export
→ reload
→ continue
```

对每篇打分 / 记录：

### Paper Understanding

- research question；
- study type；
- groups；
- main claims。

### Figure

- key figure selection；
- panel crop；
- label / legend preservation。

### Story

- Results 占比；
- one slide one message；
- logical transitions。

### Scientific Accuracy

- causality；
- species；
- cell / tissue / cohort；
- statistics；
- endpoint。

### Export

- opening；
- editability；
- geometry；
- missing assets。

---

## 15. MVP Release 最小回归

至少自动保护：

### Unit

- schema；
- bbox；
- mutation；
- undo；
- checkpoint；
- source relationship。

### Integration

- PDF → Paper；
- Paper → Deck；
- Revision Transaction；
- Persist / Restore；
- Deck → PPTX。

### E2E / Manual

- 3 Golden Papers。

不要以“补覆盖率”为目标扩张测试。

---

## 16. 发布前隐私 / 产品文案

设置中明确：

### Local

保存：

```text
PDF
Paper AST
Deck AST
Figure Cache
Project Metadata
Agent History
```

### External Model Provider

可能发送必要：

```text
论文文本片段
Page / Figure 图片
Prompt context
```

不声称“所有数据永远不出本机”。

API Key：

- 不发送到 smartJC 自建服务；
- 按当前实现决定是否本地持久化，并与产品文档保持一致；
- 不进入 Agent 消息 / export / log。

---

## 17. Definition of Done

- [ ] Checkpoint 可持久化；
- [ ] 刷新 / 重开可恢复到最近稳定阶段；
- [ ] 取消不会污染 Current Artifact；
- [ ] Provider 切换只影响下一次模型调用；
- [ ] Regenerate Deck 失败不丢 Current Deck；
- [ ] Previous Major 可恢复；
- [ ] PDF 缺失有 degraded mode；
- [ ] Figure cache 可从 PDF + bbox 重建；
- [ ] Reattach 会验证论文身份；
- [ ] 错误 UI 能给出可执行恢复动作；
- [ ] Offline 边界明确；
- [ ] 三篇 Golden Paper 完整回归通过；
- [ ] PPTX 在 PowerPoint / Keynote 中可打开并继续编辑；
- [ ] 隐私 / 本地存储提示准确；
- [ ] 不存在 MVP 外大型功能扩张。

---

## 18. MVP 发布标准

当 M6 完成，可以把当前版本定义为：

> **smartJC MVP**

真正值得继续优化的优先级：

```text
1. Biomedical scientific accuracy
2. Figure / Panel correctness
3. Story planning quality
4. Revision controllability
5. Preview / PPTX consistency
6. Performance
7. 最后才是更多编辑功能
```

---

## 19. 下一步

M6 后先真实使用，不自动进入 M7。

根据真实反馈决定：

- 修复当前核心质量；
- 或进入 M7 P1 可用性增强。
