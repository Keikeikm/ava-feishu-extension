import type { AnalysisResult, PendingAnalysis } from '../../shared/types';

export interface ConversationScope {
  userId: string;
  baseId: string;
  viewId: string;
}
export interface SourceSettings {
  viewId?: string;
  selected: string[];
  related?: {
    tableId: string;
    viewId?: string;
    selected: string[];
    primaryKey: string;
    relatedKey: string;
  };
}
export interface Conversation {
  version: 1 | 2;
  question: string;
  history: AnalysisResult[];
  resultId?: string;
  tab: 'chart' | 'data' | 'sql';
  page: 'analysis' | 'data';
  pending: PendingAnalysis | null;
  error: string;
  settings: SourceSettings;
}

export const conversationKey = (scope: ConversationScope, tableId: string) =>
  JSON.stringify([scope.userId, scope.baseId, scope.viewId, tableId]);

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('ava-conversations', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('sessions');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('会话存储被其他页面占用'));
  }).catch((error) => {
    database = undefined;
    throw error;
  });
  return database;
}

export async function readConversation(key: string): Promise<Conversation | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readonly');
    const request = transaction.objectStore('sessions').get(key);
    transaction.oncomplete = () => {
      const value = request.result;
      resolve(value?.version === 1 || value?.version === 2 ? value : null);
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** No source rows, service tokens or provider keys are stored here. */
export async function writeConversation(key: string, value: Conversation): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

const activeKey = (scope: ConversationScope) =>
  JSON.stringify(['active', scope.userId, scope.baseId, scope.viewId]);
export async function readActiveSource(scope: ConversationScope): Promise<string | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readonly');
    const request = transaction.objectStore('sessions').get(activeKey(scope));
    transaction.oncomplete = () =>
      resolve(typeof request.result === 'string' ? request.result : undefined);
    transaction.onerror = () => reject(transaction.error);
  });
}
export async function writeActiveSource(scope: ConversationScope, tableId: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite');
    transaction.objectStore('sessions').put(tableId, activeKey(scope));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}
