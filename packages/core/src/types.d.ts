import { WS_CORE_STATUS } from './constants'

export interface ReconnectOptions {
  baseDelay?: number
  maxDelay?: number
  backoffFactor?: number
  maxAttempts?: number | null // null表示无限重试
}

export interface WSMessage<T = any> {
  data: T
  type?: string
}

export interface WSCoreEventMap {
  open: Event
  message: WSMessage
  error: Event
  close: CloseEvent
  reconnecting: { attempt: number }
  reconnectfailed: void
}

export interface WSCoreOptions {
  url: string | (() => string)
  protocols?: string | string[]
  reconnectOptions?: ReconnectOptions
  heartbeatOptions?: HeartbeatOptions
  logger?: LoggerInterface
  messageParser?: (data: any) => any
}

export interface WSCoreInterface<
  CustomServerEvents extends Record<string, any> = {},
  CustomClientEvents = any
> {
  connect(): void
  disconnect(code?: number, reason?: string): void
  reconnect(): void
  destroy(): void
  getStatus(): WS_CORE_STATUS
  send(data: CustomClientEvents): boolean
  on<K extends keyof CustomServerEvents & string>(
    event: K,
    listener: (data: CustomServerEvents[K]) => void
  ): void
  off<K extends keyof CustomServerEvents & string>(
    event: K,
    listener: (data: CustomServerEvents[K]) => void
  ): void
}

export interface EventEmitterInterface {
  on(
    event: string,
    listener: EventListener,
    options?: AddEventListenerOptions
  ): void
  off(
    event: string,
    listener: EventListener,
    options?: EventListenerOptions
  ): void
  emit(event: string, data?: any): void
  clearAll(): void
}

export interface LoggerInterface {
  setLevel: (level: string) => void
  debug: (...args: any[]) => void
  info: (...args: any[]) => void
  warn: (...args: any[]) => void
  error: (...args: any[]) => void
}

export interface HeartbeatOptions {
  enabled: boolean
  interval: number // 心跳间隔（毫秒）
  message: string // 心跳消息内容
  timeout?: number // 心跳响应超时时间
  isHeartbeat: (data: string) => boolean
}
