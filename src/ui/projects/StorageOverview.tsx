import { RefreshCw } from 'lucide-react';
import { Button } from '../controls';
import type { getProjectStorageOverview } from '../../app/projects/projectService';

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 ** 2 ? 1 : bytes < 1024 ** 3 ? 2 : 3;
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KB', 'MB', 'GB'][unit]}`;
}

export function StorageOverview({
  value,
  loading,
  failed,
  onRefresh,
}: {
  value?: Awaited<ReturnType<typeof getProjectStorageOverview>>;
  loading: boolean;
  failed: boolean;
  onRefresh: () => void;
}) {
  const estimate = value?.estimate;
  const valid =
    estimate?.status === 'available' &&
    Number.isFinite(estimate.usage) &&
    estimate.usage >= 0 &&
    Number.isFinite(estimate.quota) &&
    estimate.quota > 0;
  const percentage = valid ? Math.min(100, Math.max(0, (estimate.usage / estimate.quota) * 100)) : undefined;
  const status = loading
    ? '读取中'
    : failed || estimate?.status === 'failed'
      ? '读取失败，可重试'
      : !valid
        ? '浏览器未提供可用估算'
        : percentage! >= 90
          ? '接近估算配额'
          : '当前浏览器估算';
  return (
    <section aria-labelledby="storage-title" className="mb-5 shrink-0 rounded border border-line bg-white px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-5">
        <h2 id="storage-title" className="text-sm font-medium">
          浏览器存储 <span className="ml-3 text-xs font-normal text-muted">{status}</span>
        </h2>
        <Button disabled={loading} onClick={onRefresh}>
          <RefreshCw size={14} />
          刷新
        </Button>
      </div>
      <div className="grid grid-cols-[3fr_2fr] gap-8">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3 text-sm" aria-live="polite">
            <p>
              {loading
                ? '正在读取浏览器估算…'
                : valid
                  ? `${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`
                  : '已用空间 / 配额：—'}
            </p>
            <span className="text-xs text-muted">
              {!loading && valid ? `估算剩余 ${formatBytes(Math.max(0, estimate.quota - estimate.usage))}` : ''}
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="浏览器估算空间使用比例"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={loading ? undefined : percentage}
            aria-valuetext={loading || !valid ? status : `${percentage!.toFixed(1)}%`}
            className="h-2 overflow-hidden rounded bg-line"
          >
            <div
              className={percentage !== undefined && percentage >= 90 ? 'h-full bg-amber-600' : 'h-full bg-accent'}
              style={{ width: `${loading ? 0 : (percentage ?? 0)}%` }}
            />
          </div>
        </div>
        <div className="border-l border-line pl-6">
          <p className="text-xs text-muted">全部项目 · 本应用 PDF 文件</p>
          <p className="mt-1 text-sm">
            {value ? `${value.fileCount} 份 · ${formatBytes(value.fileBytes)}` : '文件统计：—'}
          </p>
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">
        站点估算包含同源数据库与缓存，不是系统磁盘空间或本应用独占容量；PDF 文件已包含在站点占用中，不应相加。
        {percentage !== undefined && percentage >= 90 ? ' 可删除不需要的项目释放空间。' : ''}
        {value ? ` 最近读取 ${new Date(value.readAt).toLocaleTimeString('zh-CN')}。` : ''}
      </p>
    </section>
  );
}
