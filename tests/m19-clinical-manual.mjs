import assert from 'node:assert/strict';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const name = 'clinical-vrc07-phase1-trial';
const prefix = 'output/playwright/m19-' + name;
const before = JSON.parse(await readFile(prefix + '-review.json', 'utf8'));
await copyFile(prefix + '-review.json', prefix + '-review-initial.json');
for (const n of [9, 12, 14, 15, 16, 17, 18])
  await copyFile(prefix + '-figures/page-' + n + '.jpg', prefix + '-figures/page-' + n + '-initial.jpg');
const browser = await chromium.launchPersistentContext(join(tmpdir(), 'smartjc-m19-' + name), {
  channel: 'msedge',
  headless: true,
});
try {
  const page = browser.pages()[0] || (await browser.newPage());
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.goto(process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5191/');
  const commands = await page.evaluate(
    async ({ id }) => {
      const { createReviewSession } = await import('/src/app/composition.ts');
      const session = createReviewSession(id);
      await session.load();
      const paper = () => session.snapshot().data.paper;
      const commands = [];
      const save = async (command, reason) => {
        await session.save(command);
        commands.push({ command, reason });
      };
      const bbox = ([x, y, right, bottom]) => ({
        x: x / 1200,
        y: y / 1553,
        width: (right - x) / 1200,
        height: (bottom - y) / 1553,
      });
      for (const n of [14, 15, 16, 17, 18]) {
        const figure = paper().figures.find((f) =>
          f.regions.some((r) => paper().sources.find((s) => s.id === r.sourceId).pageNumber === n),
        );
        assertFigure(figure);
        for (const region of figure.regions)
          for (const panel of [...region.panels])
            await save(
              { kind: 'delete-panel', regionId: region.id, panelId: panel.id },
              '保留完整图的共享坐标轴和治疗组图例；移除会丢失科学标注的自动分块',
            );
      }
      function assertFigure(f) {
        if (!f) throw new Error('Missing expected figure');
      }
      const edits = [
        [9, 'B', [141, 1040, 1130, 1292], '移除相邻 A 表格，保留 B 的完整时间线'],
        [12, null, [350, 140, 1140, 1290], '完整保留两组图标题、坐标和图例，排除图注'],
        [12, 'A', [365, 145, 1140, 498], '恢复疼痛图标题和右侧 None 图例'],
        [12, 'B', [355, 500, 1140, 1288], '恢复右侧图例并排除图注'],
        [15, null, [130, 140, 1140, 810], '完整保留共享 Days 坐标轴'],
        [16, null, [130, 140, 1135, 1195], '恢复顶部 1000 刻度，保留两行图例并排除图注'],
        [17, null, [225, 140, 1140, 820], '保留所有病毒株分面及两行治疗组图例'],
        [18, null, [165, 140, 1140, 1148], '恢复 Week 标题、AB 标签、坐标及第二行图例'],
      ];
      // Expand Figure 2 before editing its panels, then tighten to the reviewed bounds.
      const f2 = paper().figures.find((f) =>
        f.regions.some((r) => paper().sources.find((s) => s.id === r.sourceId).pageNumber === 12),
      );
      await save(
        { kind: 'box', regionId: f2.regions[0].id, bbox: bbox([110, 130, 1150, 1400]) },
        '临时扩展整图以便独立修正两个 Panel',
      );
      for (const [n, label, rect, reason] of edits.filter((e) => !(e[0] === 12 && e[1] === null))) {
        const f = paper().figures.find((f) =>
          f.regions.some((r) => paper().sources.find((s) => s.id === r.sourceId).pageNumber === n),
        );
        const r = f.regions[0];
        const p = label && r.panels.find((p) => p.label === label);
        if (label && !p) throw new Error('Missing panel ' + label);
        await save({ kind: 'box', regionId: r.id, ...(p ? { panelId: p.id } : {}), bbox: bbox(rect) }, reason);
      }
      await save({ kind: 'box', regionId: f2.regions[0].id, bbox: bbox(edits[1][2]) }, edits[1][3]);
      session.close();
      return commands;
    },
    { id: before.project.id },
  );
  await writeFile(
    prefix + '-manual.json',
    JSON.stringify(
      {
        commands,
        finalBoxEdits: 8,
        temporaryExpansion: 1,
        deletedPanels: commands.filter((c) => c.command.kind === 'delete-panel').length,
      },
      null,
      2,
    ),
  );
  console.log('PASS: clinical scientific figure corrections saved through FigureSession');
} finally {
  await browser.close();
}
