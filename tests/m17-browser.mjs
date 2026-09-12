import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { responsesEvent } from './responses-fixture.ts';
const { chromium } = await import(process.env.SMARTJC_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.SMARTJC_BASE_URL || 'http://127.0.0.1:5176/';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
await mkdir('output/playwright', { recursive: true });
const errors = [];
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base);
  const pdf = (await readFile('test-fixtures/papers/clinical-vrc07-phase1-trial.pdf')).toString('base64');
  const seeded = await page.evaluate(async (pdf) => {
    const { createM16Fixture } = await import('/tests/m16-fixture.ts');
    const { speechFixture } = await import('/tests/speech-fixture.ts');
    const { settingsService } = await import('/src/app/composition.ts');
    await settingsService.save({
      protocol: 'responses',
      baseUrl: 'https://api.deepseek.com',
      modelId: 'fixed-model',
      apiKey: 'fixed-test-key',
      reasoningEffort: null,
    });
    const id = await createM16Fixture(
      new Blob([Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0))], { type: 'application/pdf' }),
    );
    return { id, content: speechFixture().target.content };
  }, pdf);
  let generated = 0;
  let aiCalls = 0;
  await page.route('https://api.deepseek.com/**', async (route) => {
    const body = route.request().postDataJSON();
    let delta;
    if (body.tools?.some((t) => t.name === 'plan_propose_revision')) {
      if (!aiCalls++) {
        const messages = body.input.filter((m) => m.role === 'user');
        const context = JSON.parse(messages.at(-1).content.find((c) => c.type === 'input_text').text);
        const paragraphId = context.speechParagraphs[0].id;
        delta = {
          tool_calls: [
            {
              id: 'proposal-call',
              function: {
                name: 'plan_propose_revision',
                arguments: JSON.stringify({
                  summary: '预览修改讲稿',
                  commands: [{ type: 'update-paragraph', paragraphId, text: 'AI 预览后的讲述。证据强度保持不变。' }],
                }),
              },
            },
          ],
        };
      } else delta = { content: '请查看讲稿差异，应用后才保存。' };
    } else {
      generated++;
      const input = JSON.parse(
        body.input.find((message) => message.role === 'user').content.find((content) => content.type === 'input_text')
          .text,
      );
      const result = structuredClone(seeded.content);
      result.speech.forEach((segment, index) => {
        segment.claimIds = index === 0 ? input.paper.claims.map((claim) => claim.id) : [];
        segment.sourceIds = index === 0 ? input.paper.sources.map((source) => source.id) : [];
      });
      delta = {
        tool_calls: [
          {
            id: 'speech-result',
            function: { name: 'submit_result', arguments: JSON.stringify({ result }) },
          },
        ],
      };
    }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: responsesEvent(delta) });
  });
  await page.goto(`${base}#/project/${seeded.id}`);
  await page.reload();
  await page.getByRole('button', { name: '确认切分', exact: true }).click();
  await page.getByRole('button', { name: '生成大纲与讲稿', exact: true }).click();
  await page.getByLabel('讲稿正文', { exact: true }).first().waitFor({ timeout: 60000 });
  assert.equal(generated, 1);
  const read = () =>
    page.evaluate(async (id) => await (await import('/src/app/composition.ts')).speechStore.open(id), seeded.id);
  let saved = await read();
  assert.equal(saved.record.stage, 'outline-ready');
  assert.equal(saved.project.currentDeckId, undefined);
  assert.deepEqual(saved.record.plan.slides, []);
  const originalId = saved.target.content.speechParagraphs[0].id;
  const chapters = page.locator('aside [draggable="true"]');
  await chapters.first().dragTo(chapters.nth(1));
  await page.waitForFunction(() => document.querySelector('[aria-label="章节标题"]').value === '边界与补充');
  await chapters.nth(1).getByRole('button', { name: '上移', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="章节标题"]').value === '核心发现');
  const first = page.getByLabel('讲稿正文', { exact: true }).first();
  await first.focus();
  await first.dispatchEvent('compositionstart', { data: '' });
  await first.fill('手工正文第一句。第二句用于拆分。');
  assert.equal(await first.evaluate((el) => el === document.activeElement), true);
  await first.dispatchEvent('compositionend', { data: '拆分' });
  await page.getByRole('button', { name: '发现覆盖', exact: false }).click();
  await page.waitForFunction(async (id) => {
    const s = await (await import('/src/app/composition.ts')).speechStore.open(id);
    return s.target.content.speech[0].text === '手工正文第一句。第二句用于拆分。';
  }, seeded.id);
  await page.getByRole('button', { name: '拆分讲述', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="讲稿正文"]').length === 3);
  await page.waitForFunction(() => document.querySelector('[aria-label="拖动讲述"]').draggable);
  await page
    .getByLabel('拖动讲述', { exact: true })
    .first()
    .dragTo(page.locator('[data-paragraph]').nth(1), { targetPosition: { x: 12, y: 12 } });
  await page.waitForFunction((id) => document.querySelector('[data-paragraph]').dataset.paragraph !== id, originalId);
  await page.getByRole('button', { name: '段落上移', exact: true }).nth(1).click();
  await page.waitForFunction((id) => document.querySelector('[data-paragraph]').dataset.paragraph === id, originalId);
  await page.getByRole('button', { name: '合并下段', exact: true }).first().click();
  await page.waitForFunction(() => document.querySelectorAll('[aria-label="讲稿正文"]').length === 2);
  saved = await read();
  assert.equal(saved.target.content.speechParagraphs[0].id, originalId);
  const checks = page.getByRole('group', { name: '多选图证据' }).getByRole('checkbox');
  if ((await checks.count()) > 1) {
    await checks.first().click();
    await page.waitForFunction(() => document.querySelector('fieldset input[type="checkbox"]').checked);
    await page.getByRole('button', { name: '重做', exact: true }).waitFor();
  }
  const divider = page.getByRole('separator', { name: '调整证据栏宽度' });
  await divider.focus();
  await divider.press('ArrowLeft');
  await page.getByLabel('搜索章节').fill('核心');
  assert.equal(await page.getByLabel('章节标题').count(), 2, '搜索只筛目录，不删除正文');
  await page.getByLabel('搜索章节').fill('');
  await page.getByLabel('章节主线或补充').first().selectOption('supplement');
  await page.waitForFunction(
    async (id) =>
      (await (await import('/src/app/composition.ts')).speechStore.open(id)).target.content.sections[0].track ===
      'supplement',
    seeded.id,
  );
  await page.getByLabel('章节主线或补充').first().selectOption('main');
  await page.waitForFunction(
    async (id) =>
      (await (await import('/src/app/composition.ts')).speechStore.open(id)).target.content.sections[0].track ===
      'main',
    seeded.id,
  );
  await page.waitForFunction(() => document.querySelector('header [role="status"]').textContent === '已保存');
  // 一次实际存储失败保留输入，继续打字后重试。
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (stores, mode, options) {
      if (mode === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        throw new DOMException('fixed failure', 'QuotaExceededError');
      }
      return original.call(this, stores, mode, options);
    };
  });
  await first.fill('失败仍保留。');
  await page.getByLabel('搜索章节').focus();
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor();
  assert.equal(await first.inputValue(), '失败仍保留。');
  await first.fill('失败后继续输入，保存完整。');
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await page.getByRole('button', { name: '重试保存', exact: true }).waitFor({ state: 'hidden' });
  await first.focus();
  await first.evaluate((node) =>
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })),
  );
  assert.equal(await first.inputValue(), '失败后继续输入，保存完整。');
  await page.getByRole('button', { name: '展开 AI 输入', exact: true }).click();
  await page.getByLabel('AI 操作模式').selectOption('modify');
  await page.getByLabel('AI 输入').fill('在保持证据强度的前提下改写当前讲述');
  await page.getByRole('button', { name: '发送', exact: true }).click();
  await page.getByRole('button', { name: '应用修改', exact: true }).waitFor({ timeout: 30000 });
  assert.equal(await first.inputValue(), '失败后继续输入，保存完整。');
  await page.screenshot({ path: 'output/playwright/m17-proposal.png' });
  await page.getByRole('button', { name: '应用修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="讲稿正文"]').value.startsWith('AI 预览'));
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector('[aria-label="讲稿正文"]').value === '失败后继续输入，保存完整。',
  );
  await page.getByRole('button', { name: '收起 AI', exact: true }).click();
  await page.getByText('正在裁切…', { exact: true }).first().waitFor({ state: 'hidden' });
  await page.screenshot({ path: 'output/playwright/m17-workspace.png' });
  await page.reload();
  await first.waitFor();
  assert.equal(await first.inputValue(), '失败后继续输入，保存完整。');
  assert.equal(generated, 1, '刷新不重跑模型');
  assert.equal(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight), false);
  assert.deepEqual(errors, []);
  await writeFile(
    'output/playwright/m17-browser.json',
    JSON.stringify({ generated, aiCalls, errors, saved: await read() }, null, 2),
  );
  const contracts = await page.evaluate(
    async (id) => (await import('/tests/speech-storage-contracts.ts')).runSpeechStorageContracts(id),
    seeded.id,
  );
  await writeFile('output/playwright/m17-storage.json', JSON.stringify(contracts, null, 2));
  console.log('M17 browser passed');
} catch (cause) {
  await page?.screenshot({ path: 'output/playwright/m17-browser-failed.png' });
  console.log((await page?.locator('body').innerText())?.slice(0, 8000));
  throw cause;
} finally {
  await browser.close();
}
