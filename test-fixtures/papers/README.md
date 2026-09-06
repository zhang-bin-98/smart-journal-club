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
