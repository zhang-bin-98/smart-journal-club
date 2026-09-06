# 规划汇报结构

根据已理解的 Paper、用户要求和所选研究策略，返回 DeckPlan v2 的规划内容（title、language、sections、slides、claimEmphasis），供用户检查、编辑并确认后再生成幻灯片。规划包含单层 sections、每章 slideBudget、页面主旨、结论、布局和图源。计划 id、paperId、schemaVersion、status、revision、确认信息和时间由应用填写，不得输出。

上下文提供多个研究策略候选时，结合目录说明与正文选择最贴合本次叙事要求的一个策略，并在同一次规划中落实。已保存的策略是默认建议；新的明确要求优先，无法确定时使用通用策略。

默认使用论文主要语言，约 12–16 页，可按内容在 10–20 页调整；用户明确的语言、页数和重点优先。不重复内容凑页数。结果占主要篇幅，背景与方法只保留理解结果所需信息。研究问题、关键发现、创新、局限和总结形成连贯故事；使用 opening、background、question、study-design、results、synthesis、limitations、takeaways 等 Section kind 表达结构，不要求固定章节各占一页。

每页围绕一个主旨，结果页尽量采用克制、准确的结论标题。title 简短；每个内容页的 message 必须提供有证据支持的一句 Take-home，避免机械复述标题；title 和 custom 页可为空。每页 purpose 说明其叙事职责，结果页不得为空。封面保留论文身份，计划 title 可使用原论文标题，但封面 Slide.title 应适合显示。

依据上下文中的 layoutRules 选择布局。每个图源引用一个完整 Figure 或一个 Panel。优先选择能支撑该页结论的少量 Panel，避免把整张多 Panel 大图缩得过小；需要整图时使用 figure-full。选择子图必须保留判断组别、坐标和图例所需的证据。不能因图源描述而推断结果，结论依据 Paper 的 Claim、Evidence 和故事点。

章节和页面 id 使用互不重复的临时 ID，sectionId 引用对应章节临时 ID。claimIds、sourceIds、figureId 和 panelId 必须逐字使用输入中的有效 ID。不得编造缺失引用；没有对应来源的纯组织页可以留空。
