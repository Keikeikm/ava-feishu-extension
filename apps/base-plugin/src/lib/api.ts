import type { AnalysisJob, PendingAnalysis, ServerStatus } from '../../shared/types';

declare const __AVA_API_ORIGIN__: string;
declare const __AVA_MANAGED_CONNECTION__: boolean;
export const apiOrigin = typeof __AVA_API_ORIGIN__ === 'undefined' ? '' : __AVA_API_ORIGIN__;
export const automaticConnection =
  typeof __AVA_MANAGED_CONNECTION__ !== 'undefined' && __AVA_MANAGED_CONNECTION__;

const tunnelHeaders: Record<string, string> = /^https:\/\/[a-z0-9-]+\.ngrok-free\.(app|dev)$/i.test(
  apiOrigin,
)
  ? { 'ngrok-skip-browser-warning': '1' }
  : {};

export function apiUrl(path: string) {
  return `${apiOrigin}${path}`;
}

export class AnalysisRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function analysisJobRequest(
  pending: PendingAnalysis,
  token: string,
  signal: AbortSignal,
  payload?: unknown,
): Promise<AnalysisJob> {
  const response = await fetch(
    apiUrl(payload ? '/api/analysis-jobs' : `/api/analysis-jobs/${pending.id}`),
    {
      method: payload ? 'POST' : 'GET',
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      headers: {
        ...tunnelHeaders,
        ...(!automaticConnection && token ? { Authorization: `Bearer ${token.trim()}` } : {}),
        ...(payload ? { 'Content-Type': 'application/json' } : { 'X-AVA-Job-Key': pending.key }),
      },
      ...(payload ? { body: JSON.stringify({ id: pending.id, key: pending.key, payload }) } : {}),
    },
  );
  const body = await response.json();
  if (!response.ok) throw new AnalysisRequestError(body.error || '分析请求失败', response.status);
  return body;
}

export async function fetchServerStatus(token = '', signal?: AbortSignal): Promise<ServerStatus> {
  const read = async (path: string, accessToken = '') => {
    const response = await fetch(apiUrl(path), {
      headers: {
        ...tunnelHeaders,
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new AnalysisRequestError(
        body.error || `分析服务返回 HTTP ${response.status}`,
        response.status,
      );
    }
    const body = await response.json();
    if (typeof body.ready !== 'boolean' || typeof body.authRequired !== 'boolean') {
      throw new Error('分析服务返回的状态无效，请确认连接地址。');
    }
    return body as ServerStatus;
  };
  const status = await read('/api/status');
  return status.authRequired && (automaticConnection || token.trim())
    ? read('/api/connection', automaticConnection ? '' : token.trim())
    : status;
}

/** Fetch-based SSE keeps both credentials in headers and supports abort/reconnect. */
export async function streamAnalysisJob(
  pending: PendingAnalysis,
  token: string,
  signal: AbortSignal,
  onEvent: (event: import('../../shared/types').JobStreamEvent) => void,
) {
  const response = await fetch(apiUrl(`/api/analysis-jobs/${pending.id}/events`), {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(150_000)]),
    headers: {
      ...tunnelHeaders,
      Accept: 'text/event-stream',
      'X-AVA-Job-Key': pending.key,
      ...(!automaticConnection && token ? { Authorization: `Bearer ${token.trim()}` } : {}),
    },
  });
  if (!response.ok) throw new AnalysisRequestError('实时连接暂不可用', response.status);
  if (!response.headers.get('Content-Type')?.includes('text/event-stream') || !response.body)
    throw new AnalysisRequestError('实时连接未启用', 405);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = block
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (!data) continue;
        const event = JSON.parse(data) as import('../../shared/types').JobStreamEvent;
        if (signal.aborted) return;
        onEvent(event);
        if (event.type === 'snapshot' && event.job.status !== 'running') return;
      }
      if (buffer.length > 8 * 1024 * 1024) throw new Error('实时响应过大');
      if (done) return;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
