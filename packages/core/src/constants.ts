import type { ReconnectOptions } from './types'

export enum WS_CORE_STATUS {
  CONNECTING = 'connecting',
  OPEN = 'open',
  CLOSING = 'closing',
  CLOSED = 'closed',
  ERROR = 'error',
  RECONNECTING = 'reconnecting',
}

export const DEFAULT_RECONNECT_STRATEGY: Required<ReconnectOptions> = {
  baseDelay: 1000,
  maxDelay: 30000,
  backoffFactor: 2,
  maxAttempts: null, // 默认无限重试
}
