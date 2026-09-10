import { PdfTextWorkerPool, type TextWorker } from '../src/infrastructure/pdf/localCompute';
import { PdfResource } from '../src/infrastructure/pdf/pdfResource';
import { createAnalysisResource } from '../src/infrastructure/pdf/analysisResource';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
const textItem = { str: 'Complete methods, caption and findings.', hasEOL: true, x: 10, y: 20, height: 10 };

/** Small real-browser checks: actual module messages, worker termination and fresh-instance recovery. */
export async function runPdfWorkerContracts() {
  const created: Worker[] = [];
  let terminated = 0;
  const crashUrl = URL.createObjectURL(
    new Blob(['throw new Error("fixture worker crash")'], { type: 'text/javascript' }),
  );
  const factory = (): TextWorker => {
    const worker =
      created.length === 0
        ? new Worker(crashUrl)
        : new Worker(new URL('../src/infrastructure/pdf/textBlocks.worker.ts', import.meta.url), { type: 'module' });
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      terminated++;
      terminate();
    };
    created.push(worker);
    return worker;
  };
  const pool = new PdfTextWorkerPool(factory, 1);
  try {
    const failure = await pool.reconstruct([textItem], new AbortController().signal).catch((error) => error);
    assert(failure.code === 'worker-crashed', '真实 Worker 崩溃必须使当前单元失败');
    assert(terminated === 1, '崩溃实例必须释放');
    const result = await pool.reconstruct([textItem], new AbortController().signal);
    assert(result.text === textItem.str && result.blocks.length === 1, '重建的真实模块 Worker 返回完整正文');
    const cancel = new AbortController();
    const cancelled = pool
      .reconstruct(
        Array.from({ length: 10000 }, () => textItem),
        cancel.signal,
      )
      .catch((error) => error);
    cancel.abort('cancelled fixture');
    assert((await cancelled) === 'cancelled fixture', '运行取消不能返回迟到成功');
    assert(Number(terminated) === 2, '取消必须终止不可合作的同步计算');
    const final = await pool.reconstruct([textItem], new AbortController().signal);
    assert(final.text === textItem.str, '取消后新任务可创建新 Worker');
  } finally {
    pool.dispose();
    URL.revokeObjectURL(crashUrl);
  }
  assert(created.length === terminated, '关闭释放全部 Worker');
  return { messages: 'passed', crashRecovery: 'passed', cancellation: 'passed', created: created.length, terminated };
}

/** Reuses the established three scientific papers; this measures extraction, not model quality. */
export async function inspectPdfExtraction() {
  const names = ['clinical-vrc07-phase1-trial.pdf', 'mechanism-modt-cdifficile.pdf', 'omics-torc1-proteomics.pdf'];
  const results = [];
  for (const name of names) {
    const response = await fetch(`/test-fixtures/papers/${name}`);
    assert(response.ok, `缺少论文样例 ${name}`);
    const blob = await response.blob();
    const resource = new PdfResource(blob);
    const controller = new AbortController();
    try {
      const pdf = await resource.getDocument();
      const pages = await resource.pageTexts(controller.signal);
      assert(pages.length === pdf.numPages, '逐页全文不能丢页');
      assert(
        pages.every((page) => page.text === page.blocks.map((block) => block.text).join('\n\n')),
        '保存全文与块必须一致',
      );
      for (const extracted of pages) {
        const sourcePage = await pdf.getPage(extracted.pageNumber);
        const content = await sourcePage.getTextContent();
        const original = content.items.map((item) => ('str' in item ? item.str : '')).join('');
        assert(original.replace(/\s/g, '') === extracted.text.replace(/\s/g, ''), '全文块不得丢失任何 PDF 可提取字符');
        sourcePage.cleanup();
      }
      const text = pages.map((page) => page.text).join('\n');
      results.push({
        name,
        pages: pages.length,
        chars: text.length,
        blocks: pages.reduce((sum, page) => sum + page.blocks.length, 0),
        emptyPages: pages.filter((page) => !page.text.trim()).map((page) => page.pageNumber),
        methods: /methods|experimental procedures/i.test(text),
        captions: /figure|fig\./i.test(text),
        tail: pages.at(-1)?.text.slice(-100),
      });
      const canvas = document.createElement('canvas');
      await resource.render(1, canvas, 600, controller.signal);
      assert(canvas.width > 0 && canvas.height > 0, 'PDF.js 实际渲染成功');
      canvas.width = 0;
      canvas.height = 0;
      await pdf.loadingTask.destroy();
      const failed = await resource.pageText(1, controller.signal).then(
        () => false,
        () => true,
      );
      assert(failed, '被销毁的 PDF.js 实例不得伪造成功');
      const recovered = await resource.pageText(1, controller.signal);
      assert(recovered.text === pages[0].text, 'PDF.js 中断后同一资源能够从原 Blob 重开');
    } finally {
      await resource.dispose();
    }
    const adapter = createAnalysisResource(blob);
    try {
      const preview = await adapter.preview(1, new AbortController().signal);
      assert(preview.startsWith('data:image/png;base64,'), '分析页预览适配器可用');
    } finally {
      await adapter.dispose();
    }
  }
  return results;
}
