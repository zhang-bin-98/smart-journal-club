# M2 — Project / PDF / Source Core

> 目标：把“论文文件、来源、Figure 和本地项目”变成稳定可恢复的基础设施。  
> 可演示结果：上传 PDF → 创建本地 Project → 浏览页面 → 框选 Figure → Source Preview → 刷新后恢复。

---

## 1. 本里程碑解决的问题

M1 已经能显示和导出 Deck，但还不知道内容来自哪里。

M2 要建立：

```text
Original PDF
↓
Paper Page / Section
↓
SourceReference
↓
FigureRef / FigurePanel
↓
Deck FigureElement
```

这是 smartJC 科研可追溯性的基础。

---

## 2. 范围

### 必做

- Project Schema；
- Local Project 创建 / 最近项目；
- IndexedDB + OPFS 最小持久化；
- PDF 上传；
- PDF.js 文本 / 页面解析；
- PaperPage / PaperSection 基础结构；
- SourceReference 集中存储；
- NormalizedBBox；
- FigureRef / FigurePanel；
- 手工 Figure / Panel bbox；
- Source Preview；
- Crop Editor；
- Figure asset 按需 render；
- 刷新后恢复；
- PDF / cache 分离。

### 不做

- 自动 Figure detection；
- Biomedical LLM 理解；
- Claim / Evidence；
- Agent；
- 自动 Deck generation；
- Checkpoint 完整恢复体系；
- OCR；
- PDF object reconstruction；
- Project Backup / Import。

---

## 3. 核心契约

M2 结束时基本冻结：

```text
Project
PaperPage
PaperSection
SourceReference
NormalizedBBox
FigureRef
FigurePanel
ProjectRepository
PaperRepository
DeckRepository
AssetService
```

SourceReference 统一存储：

```text
Paper.sources[]
```

其他对象只引用：

```text
sourceId / sourceIds
```

不要在 Slide、Evidence、Figure 中重复复制 page/bbox/caption。

---

## 4. 存储分工

### IndexedDB

只保存结构化数据：

```text
projects
papers
decks
settings（非 secret）
```

### OPFS

保存 Blob / 大资源：

```text
original PDF
可选 page cache
figure cache
temporary export
```

缓存必须可重建。

不要把临时 Blob URL 保存进 Deck。

---

## 5. 推荐实现顺序

### Task 1 — Project Repository

创建最小：

```text
createProject
getProject
listRecentProjects
renameProject
deleteProject
```

Home 只需要：

- 上传；
- 最近项目；
- 打开；
- 重命名；
- 删除。

不加文件夹、标签、搜索。

### Task 2 — PDF Asset

上传后立即：

1. 创建 Project；
2. 把 Original PDF 保存到 OPFS；
3. 记录 fingerprint / 基础 metadata；
4. 不调用模型。

### Task 3 — PDF Parser

输出：

```text
PaperPage[]
PaperSection[]   # 初期允许 heuristic / 基础结构
```

避免长期存字符级几何。

### Task 4 — SourceReference

实现：

- page number；
- kind；
- normalized bbox；
- short textQuote；
- figureId / panelId。

加入 domain validation：

- page 合法；
- bbox 合法；
- ID 唯一。

### Task 5 — Page Renderer / AssetService

支持：

```text
renderPage(projectId, pageNumber, scale)
renderFigure(projectId, figureId, options)
```

高 DPI 只按需。

### Task 6 — Manual Figure Fixture

M2 不需要模型识别 Figure。

在 PDF 页面上提供：

```text
创建 Figure
→ 框选 bbox
→ 可选继续框 Panel
→ 保存 FigureRef
```

用于验证整个来源链。

### Task 7 — Source Preview / Crop

从 Deck FigureElement 或 FigureRef：

```text
Source
→ 打开 PDF 原页
→ 高亮 bbox
```

Crop Editor：

```text
调整 bbox
→ Apply
→ Persist
→ 重新 render Figure asset
→ 受影响 Slide 刷新
```

---

## 6. Figure 两层 Crop

必须区分：

### Paper-level

```text
FigureRef.bbox
FigurePanel.bbox
```

表示论文中的真实来源区域。

### Slide-level

```text
FigureElement.manualCropOverride
```

表示当前 Slide 的视觉裁切。

M2 的 Source Crop 修改 Paper-level bbox。

不要因为当前 Slide 想放大就篡改论文 FigureRef。

---

## 7. 本地持久化验收

至少测试：

### Case A

```text
上传 PDF
→ 创建 Figure bbox
→ 关闭 / 刷新
→ 重开 Project
```

Figure 和 Source 仍可恢复。

### Case B

删除 Figure bitmap cache：

```text
Original PDF + bbox
→ 可以重新渲染
```

### Case C

项目删除：

- PDF；
- Paper；
- Deck；
- cache；

被清理，但全局模型设置不受影响。

---

## 8. 测试

### Unit

- bbox validator；
- Source ID uniqueness；
- page range；
- repository serialize / deserialize；
- Figure → Source 关系。

### Integration

至少：

```text
PDF fixture
→ save OPFS
→ parse
→ create Source / Figure bbox
→ persist
→ reload
→ render crop
```

---

## 9. Definition of Done

- [ ] PDF 可上传并保存到本地；
- [ ] Project 可在刷新后重新打开；
- [ ] PDF 页可按需渲染；
- [ ] 文本可基础提取；
- [ ] SourceReference 集中存储；
- [ ] normalized bbox 可稳定工作；
- [ ] 可以手工创建 Figure / Panel；
- [ ] Source Preview 可以打开原页并高亮来源；
- [ ] Crop 修改后 Figure 和 Slide 可刷新；
- [ ] Figure cache 丢失时可从 PDF 重建；
- [ ] Deck 不依赖临时 Blob URL；
- [ ] 没有引入自动 AI 分析。

---

## 10. 下一里程碑入口

M3 将用模型自动填充：

```text
StudyProfile
Figure semantics
Claim
Evidence
PaperStory
```

但仍然必须写入 M2 已冻结的 Source / Figure 基础结构，而不是创造另一套来源模型。
