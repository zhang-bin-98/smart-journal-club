import assert from 'node:assert/strict';
import { responsesEvent, decodeResponseRequest } from './responses-fixture.ts';
export async function finishM19Chain(page, output) {
  const id = decodeURIComponent(new URL(page.url()).hash.split('#/project/')[1]);
  const content = await page.evaluate(
    async () => (await import('/tests/speech-fixture.ts')).speechFixture().target.content,
  );
  let speechCalls = 0;
  let slideCalls = 0;
  await page.route('https://m15-fixed.example/responses', async (route) => {
    const request = decodeResponseRequest(route.request().postDataJSON());
    const message = request.messages.find((m) => m.role === 'user').content;
    const input = JSON.parse(typeof message === 'string' ? message : message.find((c) => c.type === 'text').text);
    let result;
    if (input.section && input.speech) {
      slideCalls++;
      result = {
        slides: [
          {
            title: input.section.title,
            purpose: '回归页面',
            message: '固定证据支持观察。',
            kind: 'result',
            speechIndexes: input.speech.map((_, index) => index),
            sourceIndexes: input.figures.length ? [0] : [],
          },
        ],
      };
    } else if (input.groups) {
      result = {
        sections: input.groups.map((group, index) => ({
          id: `group-${index}`,
          kind: 'results',
          track: index % 2 ? 'supplement' : 'main',
          title: group.title,
          purpose: '组织完整讲述',
          sourceSectionIds: [group.id],
        })),
        corrections: [],
      };
    } else if (input.paper) {
      speechCalls++;
      result = structuredClone(content);
      result.speech[0].claimIds = input.paper.claims.map((c) => c.id);
      result.speech[0].sourceIds = input.paper.sources.map((s) => s.id);
      result.speech[1].sourceIds = [];
    } else return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: responsesEvent({
        tool_calls: [{ id: 'fixed', function: { name: 'submit_result', arguments: JSON.stringify({ result }) } }],
      }),
    });
  });
  await page.getByRole('button', { name: '下一步：图源核对', exact: true }).click();
  await page.getByRole('button', { name: '确认切分', exact: true }).click();
  assert.equal(speechCalls, 0, '确认图源后仍由用户主动进入讲稿');
  await page.getByRole('button', { name: '生成大纲与讲稿', exact: true }).click();
  const text = page.getByLabel('讲稿正文', { exact: true }).first();
  await text.waitFor({ timeout: 60000 });
  assert.equal(slideCalls, 0, '讲稿完成不自动进入幻灯片');
  await text.fill('主链人工修订。限定当前实验条件，保留证据强度。');
  await text.press('Tab');
  await page.getByRole('button', { name: '下一步：生成幻灯片', exact: true }).click();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor({ timeout: 60000 });
  let saved;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    saved = await page.evaluate(async (id) => (await import('/src/app/composition.ts')).slidesStore.open(id), id);
    if (saved.current) break;
    const errors = await page.getByRole('alert').allTextContents();
    if (errors.length) throw new Error(errors.join('；'));
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(saved.current, '完整生成应保存 Current');
  assert.ok(saved.current.speech.some((s) => s.text === '主链人工修订。限定当前实验条件，保留证据强度。'));
  assert.equal(saved.project.lastOpenedStep, 'slides');
  const initialCalls = speechCalls + slideCalls;
  await page.reload();
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).waitFor();
  assert.equal(speechCalls + slideCalls, initialCalls, '刷新只读取保存成果');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PPTX', exact: true }).click();
  await (await download).saveAs(`${output}/m19-main-chain.pptx`);
  console.log(await page.evaluate(async (id) => (await import('/tests/ai-contracts.ts')).runAiContracts(id), id));
  for (const [module, method] of [
    ['contracts', 'runContracts'],
    ['migration-contracts', 'runMigrationContracts'],
    ['m15-persistence-contracts', 'runM15PersistenceContracts'],
    ['pdf-worker-contracts', 'runPdfWorkerContracts'],
  ]) {
    console.log(
      await page.evaluate(
        async ([module, method]) => (await import(`/tests/${module}.ts`))[method](),
        [module, method],
      ),
    );
  }
  await page.screenshot({ path: `${output}/m19-four-step-chain.png` });
  console.log('PASS: 同项目分析 → 图源确认 → 人工讲稿 → 页面生成、刷新、PPTX 与当前存储/AI 契约');
}
