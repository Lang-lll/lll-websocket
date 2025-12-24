import { WS_CORE_STATUS, DEFAULT_RECONNECT_STRATEGY } from '../constants'
import type {
  WSCoreInterface,
  ReconnectOptions,
  WSCoreOptions,
  LoggerInterface,
  HeartbeatOptions,
} from '../types'

export class WSCore<CustomServerEvents extends Record<string, any> = {}>
  implements WSCoreInterface<CustomServerEvents>
{
  private _logger?: LoggerInterface
  private _url: string | (() => string)
  private _protocols?: string | string[]
  private _messageParser?: (data: any) => any
  private _reconnectOptions: Required<ReconnectOptions>
  private _heartbeatOptions?: HeartbeatOptions
  private _reconnectTimer: any = null
  private _reconnectAttempts = 0
  private _status: WS_CORE_STATUS = WS_CORE_STATUS.CLOSED
  private _isDestroyed = false
  private _wsInstance: WebSocket | null = null
  private _customEventListeners: Map<string, Set<Function>> = new Map()
  private _heartbeatTimer: any = null
  private _lastHeartbeatResponseTime: number = 0

  constructor(options: WSCoreOptions) {
    this._url = options.url
    this._protocols = options.protocols
    this._messageParser = options.messageParser
    this._reconnectOptions = {
      ...DEFAULT_RECONNECT_STRATEGY,
      ...options.reconnectOptions,
    }
    this._heartbeatOptions = options.heartbeatOptions
    this._logger = options.logger

    this._logger?.debug('WebSocket Core 初始化')
  }

  connect(): void {
    if (
      this._isDestroyed ||
      this._status === WS_CORE_STATUS.OPEN ||
      this._status === WS_CORE_STATUS.CONNECTING
    ) {
      return
    }

    this._status = WS_CORE_STATUS.CONNECTING
    this._logger?.debug('准备创建 WebSocket 连接')
    this.createWebSocket()
  }

  disconnect(code?: number, reason?: string): void {
    if (this._isDestroyed) {
      return
    }

    this.cleanupReconnectTimer()

    if (this._wsInstance && this._status === WS_CORE_STATUS.OPEN) {
      this._status = WS_CORE_STATUS.CLOSING
      this._wsInstance.close(code || 1000, reason)
    } else {
      this._status = WS_CORE_STATUS.CLOSED
    }

    this._reconnectAttempts = 0
    this._logger?.debug('手动断开连接')
  }

  reconnect(): void {
    if (this._isDestroyed) {
      return
    }

    this.cleanup()
    this._status = WS_CORE_STATUS.RECONNECTING
    this._logger?.debug('触发重连')
    this.scheduleReconnect()
  }

  destroy(): void {
    this._isDestroyed = true
    this.cleanup()
    this._customEventListeners.clear()
    this._logger?.debug('WebSocket 实例销毁')
  }

  getStatus(): WS_CORE_STATUS {
    return this._status
  }

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): boolean {
    if (
      this._isDestroyed ||
      !this._wsInstance ||
      this._status !== WS_CORE_STATUS.OPEN
    ) {
      this._logger?.warn('WebSocket 未连接，无法发送消息')
      return false
    }

    try {
      this._wsInstance.send(data)
      return true
    } catch (error) {
      this._logger?.error('发送消息失败:', error)
      return false
    }
  }

  on<K extends keyof CustomServerEvents & string>(
    event: K,
    listener: (data: CustomServerEvents[K]) => void
  ): void {
    if (this._isDestroyed) {
      return
    }

    if (!this._customEventListeners.has(event)) {
      this._customEventListeners.set(event, new Set())
    }
    this._customEventListeners.get(event)?.add(listener)
  }

  off<K extends keyof CustomServerEvents & string>(
    event: K,
    listener: (data: CustomServerEvents[K]) => void
  ): void {
    this._customEventListeners.get(event)?.delete(listener)
  }

  private createWebSocket(): void {
    if (this._isDestroyed) {
      return
    }

    try {
      const url = typeof this._url === 'function' ? this._url() : this._url

      this._wsInstance = this._protocols
        ? new WebSocket(url, this._protocols)
        : new WebSocket(url)

      this.setupWebSocketListeners()
    } catch (error) {
      this.handleErrorAndReconnect(new Event('error'))
    }
  }

  private setupWebSocketListeners(): void {
    if (!this._wsInstance) return

    this._wsInstance.onopen = (event: Event) => {
      this.handleOpen(event)
    }

    this._wsInstance.onmessage = (event: MessageEvent) => {
      this.handleMessage(event)
    }

    this._wsInstance.onerror = (event: Event) => {
      this.handleErrorAndReconnect(event)
    }

    this._wsInstance.onclose = (event: CloseEvent) => {
      this.handleClose(event)
    }
  }

  private handleOpen(event: Event): void {
    if (this._isDestroyed) {
      return
    }
    this.startHeartbeat()
    this._status = WS_CORE_STATUS.OPEN
    this._reconnectAttempts = 0
    this._lastHeartbeatResponseTime = Date.now()
    this._logger?.info('WebSocket 连接已打开', event)
  }

  private handleMessage(event: MessageEvent): void {
    if (this._isDestroyed) {
      return
    }

    try {
      let data = event.data

      // 跳过心跳消息
      if (
        this._heartbeatOptions?.isHeartbeat &&
        this._heartbeatOptions.isHeartbeat(data)
      ) {
        this._lastHeartbeatResponseTime = Date.now()
        this._logger?.debug('收到心跳消息')
        return
      }

      // 尝试解析 JSON 数据
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data)
        } catch {
          // 如果不是 JSON，保持原样
        }
      }

      // 使用自定义解析器
      if (this._messageParser) {
        data = this._messageParser(data)
      }

      // 分发消息到自定义事件监听器
      if (typeof data === 'object' && data !== null && 'type' in data) {
        const eventType = data.type as string
        const listeners = this._customEventListeners.get(eventType)
        if (listeners) {
          listeners.forEach((listener) => {
            try {
              listener(data)
            } catch (error) {
              this._logger?.error(`处理自定义事件 ${eventType} 时出错:`, error)
            }
          })
        }
      }
    } catch (error) {
      this._logger?.error('处理消息时出错:', error)
    }
  }

  private handleClose(event: CloseEvent): void {
    if (this._isDestroyed) {
      return
    }

    this._status = WS_CORE_STATUS.CLOSED
    this._logger?.info('WebSocket 连接已关闭', event)

    // 如果不是正常关闭，尝试重连
    if (event.code !== 1000 && event.code !== 1001) {
      this.reconnect()
    }
  }

  private handleErrorAndReconnect(event: Event): void {
    if (this._isDestroyed) {
      return
    }

    this._status = WS_CORE_STATUS.ERROR
    this._logger?.error('WebSocket 错误: ', event)

    // 错误时自动尝试重连
    this.reconnect()
  }

  private startHeartbeat(): void {
    if (this._isDestroyed || !this._heartbeatOptions?.enabled) {
      return
    }

    this.stopHeartbeat()

    const { interval, timeout = 80000 } = this._heartbeatOptions

    this._heartbeatTimer = setInterval(() => {
      if (this._status !== WS_CORE_STATUS.OPEN) {
        return
      }

      this.sendHeartbeat()

      const timeSinceLastResponse = Date.now() - this._lastHeartbeatResponseTime

      if (timeSinceLastResponse > timeout) {
        this._logger?.warn(`心跳超时，${timeSinceLastResponse}ms 未收到响应`)
        this.reconnect()
      }
    }, interval)

    this._logger?.debug(`心跳检测已启动，间隔: ${interval}ms`)
  }

  private stopHeartbeat(): void {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer)
      this._heartbeatTimer = null
    }

    this._lastHeartbeatResponseTime = 0
  }

  private sendHeartbeat(): void {
    if (
      this._isDestroyed ||
      !this._wsInstance ||
      this._status !== WS_CORE_STATUS.OPEN ||
      !this._heartbeatOptions?.message
    ) {
      return
    }

    try {
      this._wsInstance.send(this._heartbeatOptions.message)
      this._logger?.debug('发送心跳', this._heartbeatOptions.message)
    } catch (error) {
      this._logger?.error('发送心跳失败:', error)
    }
  }

  private scheduleReconnect(): void {
    if (this._isDestroyed || this._status !== WS_CORE_STATUS.RECONNECTING) {
      return
    }

    // 检查重试次数限制
    if (
      this._reconnectOptions.maxAttempts !== null &&
      this._reconnectAttempts >= this._reconnectOptions.maxAttempts
    ) {
      this._status = WS_CORE_STATUS.CLOSED
      this._logger?.debug(
        `达到重连限制。重连次数: ${this._reconnectAttempts}。`,
        '重连配置: ',
        this._reconnectOptions
      )
      return
    }

    const delay = this.calculateReconnectDelay()
    this._reconnectAttempts++

    this._logger?.debug(`${delay}ms后重连`)
    this._reconnectTimer = setTimeout(() => {
      this._logger?.debug('正在重连...')
      this.createWebSocket()
    }, delay)
  }

  private calculateReconnectDelay(): number {
    const { baseDelay, maxDelay, backoffFactor } = this._reconnectOptions
    const delay =
      baseDelay * Math.pow(backoffFactor, this._reconnectAttempts - 1)
    return Math.min(delay, maxDelay)
  }

  private cleanup(): void {
    if (this._wsInstance) {
      // 移除监听器
      this._wsInstance.onopen = null
      this._wsInstance.onmessage = null
      this._wsInstance.onerror = null
      this._wsInstance.onclose = null

      // 关闭连接
      if (
        this._wsInstance.readyState === WebSocket.OPEN ||
        this._wsInstance.readyState === WebSocket.CONNECTING
      ) {
        this._wsInstance.close(1000, 'cleanup')
      }

      this._wsInstance = null
    }

    this.stopHeartbeat()

    this.cleanupReconnectTimer()
  }

  private cleanupReconnectTimer(): void {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
  }
}
