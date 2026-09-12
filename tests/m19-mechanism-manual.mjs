import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = 'mechanism-modt-cdifficile';
const prefix = 'output/playwright/m19-' + name;
const before = JSON.parse(await readFile(prefix + '-review.json', 'utf8'));
await copyFile(prefix + '-review.json', prefix + '-review-initial.json');
for (const n of [4, 6, 8, 10, 11, 13])
  await copyFile(prefix + '-figures/page-' + n + '.jpg', prefix + '-figures/page-' + n + '-initial.jpg');
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  const result = await page.evaluate(async (id) => {
    const session = (await import('/src/app/composition.ts')).createReviewSession(id);
    await session.load();
    const paper = () => session.snapshot().data.paper;
    const region = (n) =>
      paper().figures.find((f) =>
        f.regions.some((r) => paper().sources.find((s) => s.id === r.sourceId).pageNumber === n),
      ).regions[0];
    const commands = [];
    const save = async (command, reason) => {
      await session.save(command);
      commands.push({ command, reason });
    };
    const bbox = ([x, y, r, b]) => ({ x: x / 1200, y: y / 1553, width: (r - x) / 1200, height: (b - y) / 1553 });
    for (const [n, labels] of [
      [6, ['A', 'B', 'C', '图例（共享标注）']],
      [8, ['C', 'D']],
      [11, ['B', 'C', 'D', 'E']],
      [13, ['B', 'C']],
    ]) {
      const r = region(n);
      const chosen =
        n === 6
          ? r.panels.filter((p) => !['D', 'E'].includes(p.label))
          : r.panels.filter((p) => labels.includes(p.label));
      for (const p of chosen)
        await save(
          { kind: 'delete-panel', regionId: r.id, panelId: p.id },
          '共享颜色图例需完整呈现，使用整图来源保留所有科学标注',
        );
    }
    const edits = [
      [4, null, [118, 136, 1140, 1028], '恢复 Northern blot 内参及底部 nc008 条带'],
      [4, 'B', [138, 630, 659, 1027], '保留 5S rRNA 内参及右侧 RNA 示意'],
      [4, 'C', [688, 143, 1120, 606], '恢复 C 字母和 RPKM 轴'],
      [4, 'D', [685, 627, 1135, 1027], '恢复 D 字母、分钟单位、完整 nc008 条带'],
      [6, null, [335, 120, 1135, 1288], '恢复结构图右缘和 DMS 色标'],
      [6, 'D', [355, 660, 1130, 909], '保留完整热图、核苷酸标记和 DMS 色标'],
      [6, 'E', [355, 909, 1110, 1287], '保留差异曲线和核苷酸坐标'],
      [8, null, [115, 125, 1140, 1028], '排除图注，保留共享火山图图例'],
      [8, 'B', [135, 270, 1128, 652], '恢复 Time (h) 共享横轴'],
      [10, null, [100, 120, 1142, 795], '排除图注且保留全部实验数据'],
      [10, 'A', [135, 142, 640, 480], '排除相邻 C 字母'],
      [10, 'B', [640, 145, 1134, 790], '保留显微图时点、菌株标签和比例尺'],
      [10, 'C', [135, 482, 640, 790], '恢复 C 字母与完整菌株图例，排除图注'],
      [11, null, [125, 132, 1138, 865], '排除图注，保留完整共享菌株图例'],
      [11, 'A', [135, 138, 578, 858], '恢复机制图底部直接/间接调控及上/下调图例'],
      [13, null, [115, 125, 1155, 1053], '恢复 A 字母且排除图注'],
      [13, 'A', [130, 130, 1142, 560], '完整保留五物种模型及名称，排除 BC 字母'],
      [13, 'D', [130, 837, 1145, 1048], '保留 Northern blot 内参和培养基图例，排除图注'],
    ];
    // Temporary containing boxes allow panel corrections before final tightening.
    for (const n of [4, 6, 8, 10, 11, 13]) {
      const r = region(n);
      const source = paper().sources.find((s) => s.id === r.sourceId);
      const goal = bbox(edits.find((e) => e[0] === n && e[1] === null)[2]);
      const b = source.bbox;
      const x = Math.min(b.x, goal.x),
        y = Math.min(b.y, goal.y);
      await save(
        {
          kind: 'box',
          regionId: r.id,
          bbox: {
            x,
            y,
            width: Math.max(b.x + b.width, goal.x + goal.width) - x,
            height: Math.max(b.y + b.height, goal.y + goal.height) - y,
          },
        },
        '临时扩展整图以便修正独立 Panel',
      );
    }
    for (const [n, label, rect, reason] of [...edits.filter((e) => e[1]), ...edits.filter((e) => !e[1])]) {
      const r = region(n),
        p = label && r.panels.find((p) => p.label === label);
      if (label && !p) throw new Error('Missing panel ' + label);
      await save({ kind: 'box', regionId: r.id, ...(p ? { panelId: p.id } : {}), bbox: bbox(rect) }, reason);
    }
    session.close();
    return {
      commands,
      finalBoxEdits: edits.length,
      temporaryExpansion: 6,
      deletedPanels: commands.filter((c) => c.command.kind === 'delete-panel').length,
    };
  }, before.project.id);
  await writeFile(prefix + '-manual.json', JSON.stringify(result, null, 2));
  console.log('PASS: mechanism figure corrections saved through FigureSession');
} finally {
  await browser.close();
}
