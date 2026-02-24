// lib/web-vitals.ts — Web Vitals observer. Logs to console in dev mode.

export function reportWebVitals(): void {
  import("web-vitals").then(({ onCLS, onINP, onLCP, onTTFB }) => {
    const report = (metric: { name: string; value: number; rating: string }) => {
      if (import.meta.env.DEV) {
        console.log(`[Web Vitals] ${metric.name}: ${metric.value.toFixed(1)} (${metric.rating})`);
      }
    };

    onCLS(report);
    onINP(report);
    onLCP(report);
    onTTFB(report);
  });
}
