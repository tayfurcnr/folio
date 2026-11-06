type Metric = { count: number; totalMs: number; maxMs: number; samples: number[] }
type PerfStore = { metrics: Record<string, Metric>; reset: () => void; snapshot: () => Record<string, { count: number; totalMs: number; avgMs: number; p95Ms: number; maxMs: number }> }

declare global {
  interface Window { __folioPerf?: PerfStore }
}

const enabled = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('perf') === '1'

function createStore(): PerfStore {
  const metrics: Record<string, Metric> = {}
  const store: PerfStore = {
    metrics,
    reset() { for (const key of Object.keys(metrics)) delete metrics[key] },
    snapshot() {
      return Object.fromEntries(Object.entries(metrics).map(([name, metric]) => {
        const sorted = [...metric.samples].sort((a, b) => a - b)
        return [name, { count: metric.count, totalMs: +metric.totalMs.toFixed(3), avgMs: +(metric.totalMs / Math.max(1, metric.count)).toFixed(3), p95Ms: +(sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0).toFixed(3), maxMs: +metric.maxMs.toFixed(3) }]
      }))
    },
  }
  return store
}

if (enabled && !window.__folioPerf) window.__folioPerf = createStore()

export function perfNow(): number { return enabled ? performance.now() : 0 }

export function recordPerf(name: string, durationMs = 0): void {
  const store = enabled ? window.__folioPerf : undefined
  if (!store) return
  const metric = store.metrics[name] ??= { count: 0, totalMs: 0, maxMs: 0, samples: [] }
  const value = Math.max(0, durationMs)
  metric.count++
  metric.totalMs += value
  metric.maxMs = Math.max(metric.maxMs, value)
  metric.samples.push(value)
}

export function finishPerf(name: string, start: number): void {
  if (start) recordPerf(name, performance.now() - start)
}
