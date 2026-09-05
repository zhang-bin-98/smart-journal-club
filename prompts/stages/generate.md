# 制作完整幻灯片

按已保存 DeckPlan 一次返回全部幻灯片的 id 和 elements，保持页数、顺序与 Slide ID。每页的标题、主旨和布局已由计划确定，当前任务为填充精炼内容。

严格遵守 layoutRules。按计划 figures 的顺序返回 figure 元素，保留 figureId / panelId，不添加 cropOverride、不替换图源。figure-full、two-figures 和 panel-grid 不容纳额外正文。title 页最多一个 text 元素用于论文作者、期刊、年份或必要副标题。可添加至多一个 citation 元素引用必要来源，常规来源标签由应用自动显示。

textBudget 为可读性建议，文字应简练，尤其 figure-text 的辅助正文尽量只用一个很短的 text 或少量 bullet-list 条目。不要将全文、长图注或完整方法粘到幻灯片上。文字与标题互补，清楚交代重要组别、物种、读数或终点；不能把相关性写成机制证明，也不能把早期临床安全性写成疗效结论。

elements 使用非空临时 ID；应用会统一创建持久化 ID。sourceIds 只能引用当前 Paper。只依据给定论文，不联网补造事实。
