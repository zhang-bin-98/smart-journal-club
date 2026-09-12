import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = 'clinical-vrc07-phase1-trial';
const prefix = 'output/playwright/m19-' + name;
const initial = JSON.parse(await readFile(prefix + '-speech.json', 'utf8')).result;
const edits = [
  [
    '1f593d3c-a173-4b14-af6d-7aa9a460cc66',
    '20 mg/kg IM T3（N = 21）',
    '20 mg/kg IV T3（N = 21；表 2 表头写作 IM，与试验设计、Fig 1 和 Fig 2 不一致，此处按试验设计说明为 IV）',
    '标明原表途径冲突并按设计解释',
  ],
  [
    'cd02e4c1-8f90-4fb7-992d-c6c6cb3aad41',
    '20 mg/kg IM T3',
    '20 mg/kg IV T3（表头误标 IM）',
    '年龄段沿用已核对的试验组途径',
  ],
  [
    '7a91b4d8-8e0a-4897-8e49-c13f5dd50006',
    '本文报告的分析包含 121 名接受 VRC07-523LS 的受试者，3 名安慰剂接受者的数据被排除。',
    '血清浓度及群体 PK 分析包含 121 名接受 VRC07-523LS 的受试者，排除 3 名安慰剂接受者；不能将该排除范围推广到安全性和中和活性展示。',
    '限定 PK 分析人群，避免错误排除其他终点中的安慰剂',
  ],
  [
    '147aea76-43f3-4d8a-a469-018e7b9fb709',
    'V12/第 48 周总体为 102 人（82.3%），其中较低者为 2.5 mg/kg IV（T1）组在 V14 时的 13 人（68.4%），安慰剂 IM 组为 3 人（100%）；V14/第 64 周总体完成 95 人（76.6%）。',
    'V12/第 48 周总体为 102 人（82.3%）；V14/第 64 周总体为 95 人（76.6%），其中 T1 组为 13 人（68.4%），安慰剂 IM 组为 3 人（100%）。',
    '不把不同访视时点混作同一组范围',
  ],
  [
    '6ae6ce44-1fdd-4a17-8b53-2d1b284c69de',
    '该不一致原样保留，未合并为单一途径描述。',
    '此处明确标注原表冲突，并按试验设计及 Fig 1、Fig 2 将 T3 解释为 IV；不能把表头的 IM 当作另一个试验组。',
    '解释原文冲突，不将冲突转成两套试验组',
  ],
  ['1cebe240-af7a-4b24-8688-1b8d5fad6693', '峰值几何平均滴度', '峰值几何平均浓度', '浓度单位为 μg/mL，不是中和滴度'],
  [
    '14bec481-b719-4bc0-9f05-97ddc8d87338',
    '横轴为实测、纵轴为预测',
    '横轴为预测、纵轴为实测',
    '按 Fig 5 原始轴标签纠正',
  ],
  [
    'e81ecf55-5571-4d89-a548-d21ec3259f71',
    '图内并没有直接标注显著性统计或逐组的样本量说明。',
    '图中未标注显著性检验结果；各组人数与 AUC 标在底部图例中。',
    '保留共享图例中的实际人数标注',
  ],
  [
    '15013a24-b76b-4427-9127-eca0d4cf9642',
    '即使在第 5 次给药后 8 周',
    '即使在首次给药后 8 周',
    'Fig 6 为首剂后 8 周，非第五剂',
  ],
  [
    '97f243ca-7b08-441c-9238-b0c78cd5c94f',
    '作者指出，本研究',
    '以下后续研究状态均指论文 2024 年发表时。作者指出，本研究',
    '不把发表时的研究状态当成当前状态',
  ],
  [
    'e20bb1b9-3a93-4e3c-b51b-00075ed729be',
    '可纳入 HIV-1 预防方案。',
    '值得进一步纳入 HIV-1 联合预防方案的研究，并非已验证临床保护效力。',
    '限定转化推论强度',
  ],
  [
    'a9f883b0-acfc-4f1e-9621-3eb7902d1e5d',
    '可纳入 HIV-1 预防方案。',
    '值得进一步纳入 HIV-1 联合预防方案研究，其保护效力仍需大规模试验验证。',
    '总结明确 I 期结果边界',
  ],
  [
    '25c46d82-5c1b-4193-aa50-10eb9eeee2ea',
    '第 112 天之后按 exp(a + 112 * b) / exp(b) 估算',
    '第 112 天之后由对数线性段外推估算（原文写作 exp(a + 112 * b) / exp(b)，这里仅转述原式，未据此重算 AUC）',
    '区分原文公式转述与独立计算验证',
  ],
];
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  const result = await page.evaluate(
    async ({ id, edits }) => {
      const app = await import('/src/app/composition.ts');
      const session = app.createSpeechSession(id, true);
      await session.load();
      const content = session.snapshot().data.target.content;
      const byParagraph = new Map(),
        changes = [];
      for (const [sid, from, to, reason] of edits) {
        const s = content.speech.find((s) => s.id === sid);
        if (!s || !s.text.includes(from)) throw new Error('Reviewed text changed: ' + sid);
        let text =
          byParagraph.get(s.paragraphId) ??
          content.speech
            .filter((p) => p.paragraphId === s.paragraphId)
            .map((p) => p.text)
            .join('');
        byParagraph.set(s.paragraphId, text.replace(from, to));
        changes.push({ segmentId: sid, from, to, reason });
      }
      await session.commit(
        [...byParagraph].map(([paragraphId, text]) => ({ type: 'update-paragraph', paragraphId, text })),
      );
      const state = await app.slidesStore.open(id);
      session.close();
      return {
        changes,
        result: { project: state.project, paper: state.workingPaper, record: state.record, deck: state.current },
      };
    },
    { id: initial.project.id, edits },
  );
  assert.equal(result.changes.length, 13);
  await writeFile(prefix + '-speech-edited.json', JSON.stringify(result, null, 2));
  console.log('PASS: 13 reviewed speech corrections, references and paragraph identity retained');
} finally {
  await browser.close();
}
