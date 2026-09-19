import { PdfTextWorkerPool, type TextWorker } from '../src/infrastructure/pdf/localCompute';
import { PdfResource, checkPdfFile } from '../src/infrastructure/pdf/pdfResource';
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
  await checkLongPdfAndRegion();
  return { messages: 'passed', crashRecovery: 'passed', cancellation: 'passed', created: created.length, terminated };
}

/** 同一浏览器合同补充文件门槛移除及真实 PDF 局部渲染，不调用模型。 */
async function checkLongPdfAndRegion() {
  const pages = 81;
  const contentId = pages + 3;
  const content = '1 0 0 rg 60 480 180 160 re f';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ')}] >>`,
    ...Array.from(
      { length: pages },
      () => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << >> /Contents ${contentId} 0 R >>`,
    ),
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  text += `%${' '.repeat(26 * 1024 * 1024)}\n`;
  const xref = text.length;
  text += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const file = new File([text], 'long-vector-fixture.pdf', { type: 'application/pdf' });
  await checkPdfFile(file);
  const resource = new PdfResource(file);
  const canvas = document.createElement('canvas');
  const signal = new AbortController().signal;
  try {
    assert((await resource.getDocument()).numPages === 81, '超过旧文件和页数门槛的合法 PDF 可以读取');
    await resource.renderRegion(81, canvas, { x: 0.1, y: 0.2, width: 0.3, height: 0.2 }, 2800, signal);
    assert(Math.max(canvas.width, canvas.height) === 2800, '局部输入长边属于选区而非整页');
    const pixel = canvas
      .getContext('2d')!
      .getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
    assert(pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 0, '选区偏移与原 PDF 图像一致');
  } finally {
    canvas.width = 0;
    canvas.height = 0;
    await resource.dispose();
  }
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
