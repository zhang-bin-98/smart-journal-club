# M0 — 技术路线 Spike

> 目标：在正式建设领域代码前，验证 smartJC 最关键的三条浏览器技术路线确实可行。  
> 原则：PoC 是为了做决定，不是为了顺手搭框架。

---

## 1. 里程碑目标

必须回答三个问题：

1. 浏览器能否直接可靠调用目标模型？
2. PDF.js 能否满足文本、页面渲染、bbox crop 和 Source Preview 的基础需求？
3. 同一份布局几何能否同时驱动 Web Preview 和 PPTX Export？

任何一个关键结论不成立，都应在 M0 调整路线，而不是把风险推到 M4。

---

## 2. 前置条件

- 已确定 MVP 模型：
  - DeepSeek `deepseek-v4-flash-vision-exp`
  - GLM `glm-5.3-flash`
- 使用 OpenAI-compatible Adapter 思路；
- PDF 处理采用 PDF.js；
- PPTX 采用 PptxGenJS；
- 目标运行环境是真实浏览器 / PWA，而不是 Node-only PoC。

---

## 3. Spike A — Browser Model API

### 3.1 要验证的能力

对 DeepSeek 和 GLM 分别验证：

- API Key 认证；
- 浏览器 CORS；
- 普通文本请求；
- Streaming；
- Structured Output / Tool Calling；
- Vision 图片输入；
- AbortController；
- 典型错误：
  - 401 / auth；
  - rate limit；
  - quota；
  - invalid payload；
- 合理尺寸页面图片的上传行为。

### 3.2 最小实现

只做一个独立调试页面或脚本：

```text
选择 Provider
→ 输入 API Key
→ Text Test
→ Vision Test
→ Structured / Tool Test
→ Abort Test
```

不接项目系统，不接完整 Agent UI。

### 3.3 输出

保存一份结论记录：

```text
provider
base URL
model ID
浏览器是否可直连
是否支持 streaming
是否支持 vision
是否支持 tool / structured output
错误响应格式
已知限制
```

### 3.4 Gate

至少一个 Provider 必须满足：

```text
Browser direct
+
Text
+
Vision
+
Structured result / Tool
+
Abort
```

两个 Provider 都通过最好。

如果某 Provider 无法浏览器直连：

- 不立刻建设通用后端代理；
- 先判断是否暂时只保留另一个 Provider；
- 只有产品必须支持该 Provider 时再单独决策代理方案。

---

## 4. Spike B — PDF.js

### 4.1 要验证的能力

选 2–3 篇真实生物医学论文：

- 打开 PDF；
- 获取页数和页面尺寸；
- 提取正文文本；
- 渲染页面到 Canvas；
- 获取可复现的 normalized bbox；
- 根据 `page + bbox` 高分辨率 crop；
- Source Preview 中高亮 bbox；
- 页面 Canvas 释放后可再次重建。

至少包含：

- 双栏论文；
- Figure 较复杂论文；
- 一篇组学 / 单细胞论文。

### 4.2 不做

- OCR 系统；
- PDF vector object reconstruction；
- 原始字体恢复；
- 全文高 DPI 缓存。

### 4.3 验收

同一个 bbox 在：

```text
低分辨率 Preview
中分辨率 Vision Render
高分辨率 Export Crop
```

中应指向同一视觉区域。

---

## 5. Spike C — Shared Deck Geometry

### 5.1 要验证的能力

构造一个最小 `Deck JSON`：

- title slide；
- text + figure；
- two figures；
- 4-panel grid。

使用一份布局计算结果：

```text
Deck AST
→ Layout Engine
→ ComputedSlideLayout
        ├─ Web HTML/SVG
        └─ PptxGenJS
```

### 5.2 重点观察

- 16:9 尺寸；
- 标题换行；
- 图像 `contain` / `cover`；
- figure 不拉伸；
- Web 与 PPTX 中主要框位置是否一致；
- PowerPoint / Keynote 打开是否正常。

不要求像素级完全一致。

### 5.3 Gate

如果需要 Web 和 PPTX 分别维护两套布局坐标才能工作：

> Spike 失败，必须先重新设计 Layout Engine。

---

## 6. 建议目录

PoC 可以暂存在：

```text
spikes/
├── provider/
├── pdf/
└── deck-export/
```

M0 结束后：

- 可复用的极少量代码再迁入正式模块；
- 其余 PoC 不得直接升级为长期架构。

---

## 7. 测试 / 验证

不建立完整测试体系。

至少保留：

- 一条 Provider browser smoke test 说明；
- 一个 PDF bbox fixture；
- 一个固定 Deck JSON；
- 一份导出 PPTX 人工检查记录。

---

## 8. Definition of Done

M0 完成必须同时满足：

- [ ] 至少一个目标 Provider 可在真实浏览器完成 Text + Vision + Structured / Tool 调用；
- [ ] Abort 可用；
- [ ] PDF.js 可完成 Text / Render / bbox / crop；
- [ ] normalized bbox 可跨不同 render scale 复用；
- [ ] 一个 Deck JSON 可以驱动 Web Preview；
- [ ] 同一 Layout geometry 可以驱动 PPTX；
- [ ] PPTX 可被 PowerPoint 或 Keynote 打开；
- [ ] 已记录所有会影响后续架构的限制；
- [ ] 没有为了 PoC 引入通用 Provider 平台、PDF 框架或渲染框架。

---

## 9. 交付物

```text
spikes/
docs/spike-results.md
```

`spike-results.md` 必须明确写：

```text
PASS / FAIL
决定
后续约束
```

---

## 10. 下一里程碑入口

只有三条路线都得到明确结论后进入 M1。

M1 不再讨论“是否使用 Deck AST / Shared Layout / PptxGenJS”，而开始把已经验证的最短路线产品化。
