import type { ServerStatus } from '../../shared/types';

declare const __AVA_API_ORIGIN__: string;
declare const __AVA_MANAGED_CONNECTION__: boolean;
export const apiOrigin = typeof __AVA_API_ORIGIN__ === 'undefined' ? '' : __AVA_API_ORIGIN__;
export const automaticConnection =
  typeof __AVA_MANAGED_CONNECTION__ !== 'undefined' && __AVA_MANAGED_CONNECTION__;

export function apiUrl(path: string) {
  return `${apiOrigin}${path}`;
}

export async function fetchServerStatus(token = '', signal?: AbortSignal): Promise<ServerStatus> {
  const headers =
    token && !automaticConnection ? { Authorization: `Bearer ${token.trim()}` } : undefined;
  const read = async (path: string) => {
    const response = await fetch(apiUrl(path), {
      headers,
      cache: 'no-store',
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(8000)]),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `分析服务返回 HTTP ${response.status}`);
    }
    const body = await response.json();
    if (typeof body.ready !== 'boolean' || typeof body.authRequired !== 'boolean') {
      throw new Error('分析服务返回的状态无效，请确认连接地址。');
    }
    return body as ServerStatus;
  };
  const status = await read('/api/status');
  return status.authRequired && (automaticConnection || token.trim())
    ? read('/api/connection')
    : status;
}
