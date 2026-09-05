# M5 — Revision Agent + Editor

> 目标：让用户像和“理解论文、理解当前 PPT、知道当前选中对象”的科研演示助手交流。  
> 可演示结果：自然语言局部修改 → 原子事务 → 自动刷新 → 一次 Undo。

---

## 1. 本里程碑是 Beta 核心

M4 解决：

> 自动得到第一版。

M5 解决：

> 第一版不完美时，如何低成本改成用户想要的版本。

这是 smartJC 区别于“一次性 AI PPT 生成器”的关键。

---

## 2. 范围

### 必做

- Pi Agent Revision loop；
- Agent Panel；
- SelectionContext；
- Query vs Edit Intent；
- RevisionScope；
- RevisionTransaction；
- 受控 DeckMutation；
- `deck.apply_revision`；
- Context Builder；
- 高层 Paper read tools；
- optimistic concurrency；
- working copy；
- validate / commit / rollback；
- Agent 修改摘要；
- 一次请求一次 Undo；
- 多轮上下文；
- Review-only 模式；
- 科研准确性拒绝 / 降级表达；
- 手工编辑也统一进入事务 / revision 体系。

### 不做

- Shell；
- raw JSON edit；
- 通用文件 Tool；
- 自由坐标型 Agent；
- Plugin；
- 多 Agent；
- 无限制上下文；
- 自动“顺手优化”未请求内容。

---

## 3. Tool Surface

读工具保持细粒度：

```text
paper.get
paper.get_section
paper.get_page
paper.get_figure
paper.get_claim
deck.get
```

写工具统一：

```text
deck.apply_revision
```

可选：

```text
deck.render
pptx.export
```

Agent 不直接接触：

- IndexedDB；
- OPFS；
- raw file path；
- PptxGenJS；
- raw Deck JSON write。

---

## 4. SelectionContext

至少：

```text
currentSlideId
selectedElementId
selectedFigureId
visibleSlideIds
lastRevisionTransactionId
```

歧义优先级：

```text
Selected Element
>
Current Slide
>
Explicit User Reference
>
Recent Revision Context
>
Whole Deck
```

示例：

用户选中 Figure 后说：

```text
“放大一点”
```

不再追问对象。

---

## 5. Query vs Edit

必须先区分：

### Review / Answer

```text
“这篇文章最大的创新点是什么？”
“检查一下有没有逻辑问题。”
“你觉得哪里太挤？”
```

默认：

```text
回答 / 建议
不修改
```

### Edit

```text
“把创新点加到最后一页。”
“第7页标题改短。”
“背景压成一页。”
```

默认直接执行。

---

## 6. RevisionScope

统一：

```text
element
slide
section
deck
```

默认：

> 选择完成用户目标所需的最小合理范围。

用户说：

```text
“第7页标题短一点”
```

不允许顺便改正文、Figure、其他页。

---

## 7. RevisionTransaction

核心字段：

```text
id
projectId
deckId
userMessage
scope
baseRevision
mutations
affectedSlideIds
undoSnapshotId
status
committedRevision
```

要求：

```text
committedRevision = baseRevision + 1
```

失败 / rollback：

```text
Deck.revision 不变化
```

---

## 8. Commit Algorithm

严格按：

```text
1. Read Current Deck
2. Verify baseRevision
3. Save undo snapshot
4. Clone Working Copy
5. Apply mutation batch
6. Zod validation
7. Deck domain validation
8. Scientific / Source validation
9. Layout validation
10. revision++
11. Persist Current Deck
12. Persist RevisionTransaction
13. Render affected slides
```

5–9 任一步失败：

```text
discard Working Copy
Current Deck unchanged
```

---

## 9. Optimistic Concurrency

Revision 发出后，如果用户又手工修改：

```text
transaction.baseRevision
!=
currentDeck.revision
```

旧 Agent 响应必须视为 stale。

处理：

```text
discard
→ 基于当前 Deck 重新规划
```

不要让延迟模型响应覆盖用户新修改。

---

## 10. Context Builder

局部请求默认只给：

```text
User Request
Selection
Target Slide
必要 Neighbor Slides
相关 Claims
相关 Evidence
相关 Figures / Sources
GenerationPreferences
```

只有 Deck-level 请求才扩大到整个 Deck。

禁止每次把全文 PDF + 全 Deck 塞给模型。

---

## 11. 科研准确性策略

用户请求不能覆盖基本事实。

例如：

```text
“把相关改成导致”
```

若 Claim strength 只支持 associative：

- 不执行 causal 强化；
- 给出更准确替代；
- 说明论文证据边界。

同样禁止：

- 编造样本量；
- 把不显著改成显著；
- mouse 写成人；
- prediction 写成 validation；
- gene expression 写成 protein level。

---

## 12. 常见自然语言验收

### Current Slide

```text
“这页太挤了”
```

预期：

- 只处理当前页；
- 优先换 layout / 减文字 / 拆页；
- 不改变科学含义。

### Current Figure

```text
“这张图放大一点”
```

预期：

- 使用当前 selected figure；
- 不改其他 Slide。

### Explicit Slide

```text
“第7页标题改成结论句”
```

预期：

- 只改标题；
- 强度不超过论文证据。

### Section

```text
“背景压缩成一页”
```

预期：

- 只重构 Background；
- research question 保留；
- Results 基本不动。

### Deck

```text
“整体压到12页”
```

预期：

- 全局预算重分配；
- 优先删背景 / 非关键方法 / 重复证据；
- 核心 Results 保留；
- 一次 Undo。

### Figure

```text
“Figure 3 只留 B 和 D”
```

预期：

- 映射 Paper Figure 3；
- panel source 仍正确。

### Review

```text
“帮我看看这套PPT有什么问题”
```

预期：

- 只给问题和建议；
- Deck revision 不变化。

---

## 13. 多轮上下文

场景：

```text
用户：第8页只留 A 和 C。
Agent：完成。
用户：C 再大一点。
```

第二句默认延续刚刚的 Figure C。

但如果用户随后点击第12页并说：

```text
“这页短一点”
```

当前 UI Selection 高于 conversation recency。

---

## 14. 手工操作统一

以下用户直接操作也应进入同一 Mutation / revision 体系：

- inline text edit；
- reorder；
- delete；
- crop；
- Theme；
- Add Slide。

这样：

```text
Agent 修改
=
手工修改
```

共享：

- validation；
- persistence；
- revision number；
- undo。

---

## 15. 测试

### Unit

- query/edit intent deterministic helpers；
- scope resolution；
- mutation schema；
- stale revision rejected；
- failed transaction leaves Current Deck unchanged；
- snapshot Undo；
- source link validation。

### Integration

至少：

```text
User request
→ Context
→ Agent structured revision
→ apply_revision
→ validate
→ persist
→ render
→ Undo
```

再加一个 stale response case。

---

## 16. Definition of Done

- [ ] Agent Panel 可用；
- [ ] Current Selection 会进入 Agent context；
- [ ] 能区分“问”和“改”；
- [ ] 局部请求只局部修改；
- [ ] 全局请求可以批量修改；
- [ ] 所有写入只通过受控 Revision Transaction；
- [ ] `deck.apply_revision` 是唯一 Agent 写入口；
- [ ] 一次用户请求 = 一次 Undo；
- [ ] stale Agent response 不会覆盖新 Deck；
- [ ] Source integrity 在修改后重新检查；
- [ ] 科研强度不能无证据升级；
- [ ] Review-only 不修改 Deck；
- [ ] Agent 返回简洁修改摘要；
- [ ] 手工编辑与 Agent 编辑共享 revision 体系。

---

## 17. M5 完成后的产品状态

可以标记：

> **Beta**

MVP 的主要产品体验已经完整。

之后 M6 不再增加大型产品能力，重点变成：

```text
恢复
错误处理
真实论文回归
存储安全
发布质量
```
