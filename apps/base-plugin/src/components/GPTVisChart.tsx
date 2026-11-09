import { useEffect, useRef, useState } from 'react';
import type { GPTVis } from '@antv/gpt-vis';

/** All renderer code is served from our bundle; chart HTML and CDN scripts are never executed. */
export function GPTVisChart({
  config,
  onError,
}: {
  config: Record<string, unknown>;
  onError: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const failure = useRef(onError);
  failure.current = onError;
  const [rendered, setRendered] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let disposed = false;
    let instance: GPTVis | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let resize: ResizeObserver | undefined;
    let lastWidth = 0;
    const fail = () => {
      if (!disposed) failure.current();
    };
    const hasSurface = () => {
      if (container.querySelector('svg path, svg rect, svg circle')) return true;
      for (const canvas of container.querySelectorAll('canvas')) {
        if (!canvas.width || !canvas.height) continue;
        try {
          const context = canvas.getContext('2d');
          if (!context) continue;
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          for (let index = 0; index < pixels.length; index += 4) {
            if (
              pixels[index + 3] > 0 &&
              Math.min(pixels[index], pixels[index + 1], pixels[index + 2]) < 240
            )
              return true;
          }
        } catch {
          return false;
        }
      }
      return false;
    };
    const check = () => {
      if (disposed || !hasSurface()) return;
      clearInterval(poll);
      clearTimeout(timeout);
      setRendered(config);
    };
    timeout = setTimeout(fail, 25_000);
    void import('@antv/gpt-vis')
      .then(({ GPTVis }) => {
        if (disposed) return;
        clearTimeout(timeout);
        const draw = () => {
          const width = Math.floor(container.clientWidth);
          if (!width || width === lastWidth) return;
          lastWidth = width;
          try {
            instance?.destroy();
            instance = new GPTVis({
              container,
              width,
              height: 340,
              theme: 'light',
              wrapper: false,
              locale: 'zh-CN',
            });
            // The panel already displays the chart title; reserve the surface for the plot.
            const { title: _title, ...plot } = config;
            instance.render(plot);
            clearInterval(poll);
            clearTimeout(timeout);
            poll = setInterval(check, 120);
            timeout = setTimeout(fail, 8_000);
          } catch {
            fail();
          }
        };
        draw();
        resize = new ResizeObserver(draw);
        resize.observe(container);
      })
      .catch(fail);
    return () => {
      disposed = true;
      resize?.disconnect();
      clearInterval(poll);
      clearTimeout(timeout);
      try {
        instance?.destroy();
      } catch {
        /* Renderer teardown must not interrupt the conversation. */
      }
    };
  }, [config]);
  const ready = rendered === config;
  return (
    <div
      className="antv-chart"
      data-state={ready ? 'ready' : 'loading'}
      data-chart-type={String(config.type)}
      aria-busy={!ready}
    >
      <div
        ref={host}
        className="antv-chart-surface"
        role="img"
        aria-label={typeof config.title === 'string' ? config.title : 'AntV 分析图表'}
      />
      {!ready && (
        <div className="antv-chart-loading" role="status">
          正在绘制图表…
        </div>
      )}
    </div>
  );
}
