# 代表论文测试夹具（本地）

这些 PDF 仅用于 smartJC 各里程碑的本地 PDF 解析、Figure/Panel 来源、裁图和三篇论文人工内容检查，已通过 `.gitignore` 排除，不提交到仓库。需要运行相关本地检查时，请从下列 PLOS 官方 `printable` 下载端点取得文件并放入本目录；三篇均为公开原创研究；机制与组学论文采用 Creative Commons Attribution（CC BY）许可，临床论文采用 CC0 公共领域贡献。许可信息见各 PDF 首页。

| 类别 | 文件 | 论文 | 标识 | 页数 | 大小 | SHA-256 |
| --- | --- | --- | ---: | ---: | ---: | --- |
| 机制 | `mechanism-modt-cdifficile.pdf` | The conserved noncoding RNA ModT coordinates growth and virulence in *Clostridioides difficile* | PMID 39671441；PMCID PMC11706538；DOI 10.1371/journal.pbio.3002948 | 32 | 4,119,744 bytes | `21A8EED8430D6C4434DDBC1B2B95E1E3847661CB01AA75886732923D7C9A4261` |
| 组学/生信（已采用主链） | `omics-torc1-proteomics.pdf` | Proteomic and phosphoproteomic analyses reveal that TORC1 is reactivated by pheromone signaling during sexual reproduction in fission yeast | PMID 39705284；PMCID PMC11750111；DOI 10.1371/journal.pbio.3002963 | 41 | 4,630,885 bytes | `F98B00740E59BB573CC39CFF8F00C3F2C813026FAF5AEA307763F76797041460` |
| 临床/转化 | `clinical-vrc07-phase1-trial.pdf` | Safety and pharmacokinetics of VRC07-523LS administered via different routes and doses (HVTN 127/HPTN 087): A Phase I randomized clinical trial | PMID 38913710；PMCID PMC11251612；DOI 10.1371/journal.pmed.1004329 | 25 | 8,798,194 bytes | `CC00C718817F9BE12D9B812733058DA4D22094481A7BB04A49398FAC55AFB3F1` |

来源下载地址：

- https://journals.plos.org/plosbiology/article/file?id=10.1371/journal.pbio.3002948&type=printable
- https://journals.plos.org/plosbiology/article/file?id=10.1371/journal.pbio.3002963&type=printable
- https://journals.plos.org/plosmedicine/article/file?id=10.1371/journal.pmed.1004329&type=printable

下载日期：2026-09-06。校验命令：`pdfinfo test-fixtures/papers/*.pdf`、`Get-FileHash -Algorithm SHA256`。PDF 不属于发布构建输入；若检查需要测试数据，应通过本地选择文件或 fixture 脚本注入，不把 PDF 复制到应用静态资源。

发布后图页等待问题曾使用本地《Longitudinal dynamics of gene expression and metabolomics in an aging population cohort》18 页 PDF 作定向回归。M19 退役旧五阶段入口后，旧 `tests/figure-stalls.mjs` 不再接入默认浏览器主链；当前逐单元失败/迟到响应、暂停与刷新续跑由 `tests/unit/paperWorkflow.test.ts`、`tests/unit/analysisService.test.ts` 和正式 `tests/m15-browser.mjs` 保护。原 PDF 继续本地保留，不进入仓库或部署，也不自动增加真实论文/模型组合。原历史验证结论不改写。

2026-09-19 按用户要求，将此论文补入现有 `tests/m19-live.mjs` 作为 `aging` 定向样例，使用当前四步应用的真实分析入口：

- 本地文件：`El-Sayed Moustafa 等 - 2026 - Longitudinal dynamics of gene expression and metabolomics in an aging population cohort.pdf`。
- DOI：`10.1126/science.aed6452`；18 页，4,974,276 bytes；SHA-256：`6DEE0662E7605CB70DAA799F9EF080993F334C1AA551F7423D8BDC714AE0A95E`。
- 覆盖摘要图、正文 Figure 1–6（文件内第 3、4、5、7、8、9 页）、双栏正文与末页出版信息。文件内页码与印刷页码不同，检查使用文件内页码。
- 启动本地 Vite 后，设置 `SMARTJC_PUBLIC_SAMPLE=aging`、`SMARTJC_BASE_URL` 为本地服务地址，再运行 `node tests/m19-live.mjs`。沿用本地 `.env` 验收凭据、DeepSeek Flash / high 和既有 Playwright 模块环境；真实调用只在明确运行此脚本时发生，不加入默认单元测试。
- 脚本校验文件摘要和总页数；保存文件/页级分析结果、调用阶段、输出预算、完成原因及 Token 统计，不保存 Key、请求头或隐藏推理。再次运行只续跑同一隔离测试项目的未完成单元；输出位于忽略的 `output/playwright/m19-aging-longitudinal-multiomics-*`。实际结果及限制见 [M19 工作记录](../../docs/spec/M19.md)。
