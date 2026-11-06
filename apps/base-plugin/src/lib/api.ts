declare const __AVA_API_ORIGIN__: string;
export const apiOrigin = typeof __AVA_API_ORIGIN__ === 'undefined' ? '' : __AVA_API_ORIGIN__;

export function apiUrl(path: string) {
  return `${apiOrigin}${path}`;
}
