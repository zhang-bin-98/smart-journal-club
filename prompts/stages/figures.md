# 分析当前候选图页

查看提供的完整 PDF 页图片和对应文字，识别该页实际出现的正文 Figure 及带明确标签的 Panel。输入中的 imageRegions 是 PDF.js 从页面实际图片绘制矩阵提取的坐标参考，优先用它核对 Figure 的外接范围和 Panel 的相对位置；它可能只覆盖图中的栅格图片，不一定包含图注或矢量标签，不能机械照抄。引用其他页的 Figure 名称不代表当前页有该图。没有图时返回空集合，不把表格、页眉、图注文字或参考文献当成 Figure。

为每幅图记录原始标签、图注、简短客观描述和归一化 bbox。description 只描述图形类型、测量对象、比较组及 Panel 对应关系，不推断结果方向、显著性或机制；具体结论留给结合正文和证据的论文理解步骤。bbox 相对完整图片，原点为左上角，包含图的完整可读范围；图注可单独保存在 caption 中。Panel 必须属于该 Figure，使用论文的标签，范围保留必要坐标轴、组别、图例和统计信息；无法可靠独立裁出时宁可不定义 Panel。

每幅图只输出一次。caption 只保留本页图注必要内容，最多 2400 字符；Figure description 最多 350 字符，Panel description 最多 240 字符。正文不复制到 description，不输出逐数据点解释，bbox 数值保留至多三位小数。

输出符合提供 Schema 的紧凑 JSON，不加入 Markdown 围栏或重复空白。应用会根据本次实际页码建立 SourceReference，并分配 Figure、Panel 和 Source 的持久化 ID。
