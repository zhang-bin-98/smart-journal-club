# M1 — Deck Kernel

> 目标：在完全不依赖 PDF 和 Agent 的情况下，先把 smartJC 的演示文稿核心做稳定。  
> 可演示结果：固定 Deck JSON → 浏览器预览 → 直接编辑 / Undo → PPTX。

---

## 1. 为什么先做 Deck

smartJC 的下游真值是：

```text
Deck AST
```

如果 Deck 的：

- Schema；
- Layout；
- Renderer；
- Mutation；
- Undo；
- PPTX Export；

不稳定，上游 Paper / Agent 生成得再好也无法可靠落地。

因此 M1 要先证明：

> 一个结构化 Deck 可以被确定性地编辑、渲染和导出。

---

## 2. 范围

### 必做

- Deck / Slide / SlideElement Schema；
- Zod validation；
- Stable opaque ID；
- Theme 最小模型；
- Layout Registry；
- Shared Layout Engine；
- HTML/SVG Renderer；
- PptxGenJS Export Adapter；
- Deck Mutation；
- Deck domain validation；
- Snapshot Undo / Redo 的最小实现；
- 静态 Demo Deck；
- 文本编辑；
- Slide reorder。

### 不做

- PDF；
- Paper AST；
- Figure detection；
- LLM；
- Pi Agent；
- Source Preview；
- Checkpoint 系统；
- Drag / Resize；
- 完整 Theme Picker；
- Speaker Notes UI。

---

## 3. 核心数据契约

M1 结束时应基本冻结：

```text
Deck
Slide
SlideElement
Theme
LayoutBox
ComputedSlideLayout
DeckMutation
```

建议元素白名单：

```text
text
bullet-list
figure
image
shape
citation
```

M1 的 Demo 中 `figure` 可以先用 fixture asset，后续 M2 再接 Paper FigureRef。

---

## 4. 推荐实现顺序

### Task 1 — Schema

建立：

```text
src/domain/
├── common.ts
├── deck.ts
└── revision.ts   # 只放 Mutation / snapshot 必需部分
```

要求：

- JSON serializable；
- 所有长期对象 stable ID；
- Deck 有 `schemaVersion`；
- Deck 有单调递增 `revision`；
- 不使用 class hierarchy。

### Task 2 — Layout Registry

先只实现最少布局：

```text
title
text-only
figure-full
figure-left-text-right
text-left-figure-right
two-figures
four-panel-grid
conclusion
```

只有真实 Demo 需要时才加布局。

### Task 3 — Layout Engine

输入：

```text
Slide + Theme + Layout
```

输出：

```text
ComputedSlideLayout
```

禁止：

```text
Renderer 自己重新算一套坐标
Exporter 自己重新算一套坐标
```

### Task 4 — Web Renderer

- HTML/SVG；
- 只完整渲染当前 Slide；
- thumbnail 可降采样；
- 文本 overflow 有明确处理；
- Figure 保持比例。

### Task 5 — PPTX Export Adapter

PptxGenJS 只存在于：

```text
src/export/pptx/
```

业务层不直接调用 PptxGenJS API。

### Task 6 — Mutation

首版支持：

```text
add-slide
delete-slide
move-slide
update-slide
add-element
replace-element
delete-element
set-theme
set-language
```

不引入 JSON Patch。

### Task 7 — Snapshot Undo / Redo

最小策略：

```text
Mutation 前保存 Deck JSON
→ apply
→ validate
→ commit
```

Undo 直接恢复 snapshot。

不做 event sourcing / inverse mutation framework。

---

## 5. 最小 UI

只需要一个开发态 / 初始编辑器：

```text
Slide Navigator
+
Slide Canvas
+
Undo / Redo
+
Export
```

支持：

- 点击 Slide；
- inline text edit；
- reorder；
- 删除；
- Undo / Redo。

不需要 Agent Panel。

---

## 6. Domain Validation

M1 至少检查：

- ID 唯一；
- `layoutId` 存在；
- 元素类型在白名单；
- 元素引用结构合法；
- Layout 能计算；
- Element 不出现明显越界；
- 空 Slide / 关键 overflow 可作为 warning。

区分：

```text
error → 阻止 commit
warning → 允许但记录
```

---

## 7. 测试

### Unit

只覆盖核心契约：

- valid Deck parses；
- invalid element rejected；
- invalid layout rejected；
- add / delete / move mutation；
- failed mutation 不改变 Current Deck；
- Undo 恢复完全相同 JSON；
- normalized layout box 合法。

### Integration

至少一条：

```text
fixture Deck
→ Render
→ Mutate
→ Undo
→ Export PPTX
```

---

## 8. 人工验收场景

打开 Demo Deck：

1. 切换 Slide；
2. 编辑一个标题；
3. 调整 Slide 顺序；
4. 删除一个元素；
5. Undo；
6. Redo；
7. Export；
8. 用 PowerPoint / Keynote 打开。

重点检查：

- Web Preview 与 PPTX 大体一致；
- Figure 无拉伸；
- 字体与换行差异不破坏页面；
- Undo 是用户可理解的逻辑操作。

---

## 9. Definition of Done

- [ ] Deck Schema / Zod 可工作；
- [ ] Stable ID 不依赖 slide index；
- [ ] 8 个以内核心 Layout 足够跑 Demo；
- [ ] Web 与 PPTX 共用一份 Geometry；
- [ ] 文本、图片、Figure fixture 可渲染；
- [ ] Mutation 原子应用；
- [ ] Undo / Redo 可用；
- [ ] Slide reorder 可用；
- [ ] PPTX 可编辑且可打开；
- [ ] lint / typecheck / build 通过；
- [ ] 未引入 PDF、Agent、Workflow Framework 等下阶段能力。

---

## 10. 交付后的冻结

M1 结束后：

> Deck AST / Layout Engine / Mutation API 只允许为真实上游需求做兼容性调整。

不要在 M2–M4 因为某个 Prompt 输出方便，就让 LLM 直接写坐标或绕过 Deck Schema。

---

## 11. 下一里程碑入口

M2 将把：

```text
Project
PDF
SourceReference
FigureRef
```

接入现有 Deck Kernel，但不改变其基本渲染和导出模型。
