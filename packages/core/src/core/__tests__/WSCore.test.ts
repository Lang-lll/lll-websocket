import { WSCore } from '../WSCore'
import { WS_CORE_STATUS } from '../../constants'

// @ts-ignore
global.CloseEvent = class CloseEvent {
  type: any
  code: any
  reason: any
  wasClean: any
  constructor(type: any, options: any = {}) {
    this.type = type
    this.code = options.code || 0
    this.reason = options.reason || ''
    this.wasClean = options.wasClean || false
  }
}

// Mock WebSocket
class MockWebSocket {
  static instances: MockWebSocket[] = []

  readyState: number = WebSocket.CONNECTING
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null

  sentData: any[] = []
  closed = false
  closeCode?: number
  closeReason?: string

  constructor(public url: string, public protocols?: string | string[]) {
    MockWebSocket.instances.push(this)
  }

  send(data: any): void {
    this.sentData.push(data)
  }

  close(code?: number, reason?: string): void {
    this.closed = true
    this.closeCode = code
    this.closeReason = reason
    this.readyState = WebSocket.CLOSED
  }

  triggerOpen(event: Event = new Event('open')): void {
    this.readyState = WebSocket.OPEN
    if (this.onopen) this.onopen(event)
  }

  triggerMessage(data: any, type: string = 'message'): void {
    const event = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
    })
    if (this.onmessage) this.onmessage(event)
  }

  triggerError(event: Event = new Event('error')): void {
    this.readyState = WebSocket.CLOSING
    if (this.onerror) this.onerror(event)
  }

  triggerClose(code: number = 1000, reason: string = ''): void {
    const event = new CloseEvent('close', { code, reason })
    this.readyState = WebSocket.CLOSED
    if (this.onclose) this.onclose(event)
  }

  static reset(): void {
    MockWebSocket.instances = []
  }

  static get latest(): MockWebSocket | undefined {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }
}

// Mock logger
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  setLevel: jest.fn(),
}

// Mock timers
jest.useFakeTimers()

describe('WSCore', () => {
  let originalWebSocket: any
  let wsCore: WSCore<any>

  beforeEach(() => {
    originalWebSocket = global.WebSocket
    global.WebSocket = MockWebSocket as any
    MockWebSocket.reset()

    mockLogger.debug.mockClear()
    mockLogger.info.mockClear()
    mockLogger.warn.mockClear()
    mockLogger.error.mockClear()
    mockLogger.setLevel.mockClear()

    jest.clearAllTimers()
  })

  afterEach(() => {
    global.WebSocket = originalWebSocket
    if (wsCore) {
      wsCore.destroy()
    }
  })

  describe('构造函数', () => {
    test('使用默认配置初始化', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      expect(mockLogger.debug).toHaveBeenCalledWith('WebSocket Core 初始化')
      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
    })

    test('使用自定义重连配置初始化', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        reconnectOptions: {
          baseDelay: 2000,
          maxAttempts: 5,
        },
        logger: mockLogger,
      })

      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
    })
  })

  describe('连接管理', () => {
    test('成功建立连接', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.connect()

      const mockWs = MockWebSocket.latest!
      expect(mockWs).toBeDefined()
      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CONNECTING)

      mockWs.triggerOpen()
      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.OPEN)
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WebSocket 连接已打开',
        expect.any(Event)
      )
    })

    test('重复连接被忽略', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.connect()
      wsCore.connect() // 第二次连接应该被忽略

      expect(MockWebSocket.instances).toHaveLength(1)
    })

    /*test('连接过程中销毁实例', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.connect()
      wsCore.destroy()

      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
    })*/
  })

  describe('断开连接', () => {
    test('正常断开连接', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      wsCore.disconnect(1000, '正常关闭')

      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSING)
      expect(mockWs.closeCode).toBe(1000)
      expect(mockWs.closeReason).toBe('正常关闭')
      expect(mockLogger.debug).toHaveBeenCalledWith('手动断开连接')
    })

    test('未连接时断开连接', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.disconnect()
      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
    })
  })

  describe('消息处理', () => {
    test('发送消息', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      const result = wsCore.send('test message')
      expect(result).toBe(true)
      expect(mockWs.sentData).toContain('test message')
    })

    test('未连接时发送消息失败', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      const result = wsCore.send('test message')
      expect(result).toBe(false)
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WebSocket 未连接，无法发送消息'
      )
    })

    test('接收并处理消息', () => {
      const messageHandler = jest.fn()

      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.on('testEvent', messageHandler)
      wsCore.connect()

      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      const testData = { type: 'testEvent', data: 'test' }
      mockWs.triggerMessage(testData)

      expect(messageHandler).toHaveBeenCalledWith(testData)
    })

    test('使用消息解析器', () => {
      const messageParser = jest.fn((data) => ({
        type: 'testEvent',
        parsed: JSON.parse(data),
      }))
      const messageHandler = jest.fn()

      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        messageParser,
        logger: mockLogger,
      })

      wsCore.on('testEvent', messageHandler)
      wsCore.connect()

      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      const testData = { type: 'testEvent', data: 'test' }
      mockWs.triggerMessage(testData)

      expect(messageParser).toHaveBeenCalled()
      expect(messageHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          parsed: testData,
        })
      )
    })
  })

  describe('心跳检测', () => {
    test('开启心跳检测', () => {
      const heartbeatMessage = JSON.stringify({ type: 'heartbeat' })

      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        heartbeatOptions: {
          enabled: true,
          interval: 30000,
          message: heartbeatMessage,
          isHeartbeat: (data: any) => {
            try {
              const parsed = JSON.parse(data)
              return parsed.type === 'heartbeat'
            } catch {
              return false
            }
          },
        },
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 触发心跳
      jest.advanceTimersByTime(30000)

      expect(mockWs.sentData).toContain(heartbeatMessage)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        '发送心跳',
        heartbeatMessage
      )
    })

    test('心跳超时触发重连', () => {
      jest.useFakeTimers()
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        heartbeatOptions: {
          enabled: true,
          interval: 10000,
          timeout: 20000,
          message: 'ping',
          isHeartbeat: () => false, // 不响应心跳
        },
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 触发心跳超时
      jest.advanceTimersByTime(35000)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('心跳超时')
      )
      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.RECONNECTING)

      jest.useRealTimers()
    })

    test('跳过心跳消息处理', () => {
      const messageHandler = jest.fn()

      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        heartbeatOptions: {
          enabled: true,
          interval: 30000,
          message: 'ping',
          isHeartbeat: (data: any) => data === 'pong',
        },
        logger: mockLogger,
      })

      wsCore.on('heartbeat', messageHandler)
      wsCore.connect()

      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 发送心跳响应
      mockWs.triggerMessage('pong')

      expect(messageHandler).not.toHaveBeenCalled()
      expect(mockLogger.debug).toHaveBeenCalledWith('收到心跳消息')
    })
  })

  describe('重连机制', () => {
    test('连接错误触发重连', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        reconnectOptions: {
          baseDelay: 100,
          maxDelay: 1000,
        },
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 触发错误
      mockWs.triggerError()

      // TODO: 修复状态
      // expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.ERROR)
      expect(mockLogger.error).toHaveBeenCalledWith(
        'WebSocket 错误: ',
        expect.any(Event)
      )
      expect(mockLogger.debug).toHaveBeenCalledWith('触发重连')
    })

    test('非正常关闭触发重连', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        reconnectOptions: {
          baseDelay: 100,
        },
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 非正常关闭（code 不是 1000 或 1001）
      mockWs.triggerClose(1006, '连接异常')

      // TODO: 修复状态
      // expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
      expect(mockLogger.debug).toHaveBeenCalledWith('触发重连')
    })

    test('正常关闭不触发重连', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        reconnectOptions: {
          baseDelay: 100,
        },
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 正常关闭
      mockWs.triggerClose(1000, '正常关闭')

      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
      expect(mockLogger.debug).not.toHaveBeenCalledWith('触发重连')
    })

    test('指数退避重连延迟', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        reconnectOptions: {
          baseDelay: 100,
          backoffFactor: 2,
          maxAttempts: 3,
        },
        logger: mockLogger,
      })

      wsCore.connect()
      let mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 第一次重连
      mockWs.triggerError()
      expect(mockLogger.debug).toHaveBeenCalledWith('100ms后重连')

      // TODO: 修复用例
      // 第二次重连
      /*mockWs = MockWebSocket.instances[1]
      mockWs.triggerOpen()
      mockWs.triggerError()
      expect(mockLogger.debug).toHaveBeenCalledWith('200ms后重连') // 100 * 2

      // 第三次重连
      mockWs = MockWebSocket.instances[2]
      mockWs.triggerOpen()
      mockWs.triggerError()
      expect(mockLogger.debug).toHaveBeenCalledWith('400ms后重连') // 200 * 2*/
    })

    /*test('达到最大重连次数后停止', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        reconnectOptions: {
          baseDelay: 100,
          maxAttempts: 2,
        },
        logger: mockLogger,
      })

      wsCore.connect()
      let mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 第一次重连
      mockWs.triggerError()
      mockWs = MockWebSocket.instances[1]
      mockWs.triggerOpen()

      // 第二次重连
      mockWs.triggerError()
      mockWs = MockWebSocket.instances[2]
      mockWs.triggerOpen()

      // 第三次错误（应该停止重连）
      mockWs.triggerError()

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('达到重连限制'),
        expect.any(String),
        '重连配置: ',
        expect.any(Object)
      )
      expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
    })*/
  })

  describe('事件监听', () => {
    test('添加和移除事件监听器', () => {
      const listener1 = jest.fn()
      const listener2 = jest.fn()

      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.on('event1', listener1)
      wsCore.on('event2', listener2)

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      // 触发事件
      mockWs.triggerMessage({ type: 'event1', data: 'test1' })
      mockWs.triggerMessage({ type: 'event2', data: 'test2' })

      expect(listener1).toHaveBeenCalledWith({ type: 'event1', data: 'test1' })
      expect(listener2).toHaveBeenCalledWith({ type: 'event2', data: 'test2' })

      // 移除监听器
      wsCore.off('event1', listener1)
      mockWs.triggerMessage({ type: 'event1', data: 'test3' })
      expect(listener1).toHaveBeenCalledTimes(1) // 仍然是1次
    })
  })

  describe('销毁', () => {
    test('销毁实例', async () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.connect()
      const mockWs = MockWebSocket.latest!
      mockWs.triggerOpen()

      wsCore.destroy()

      expect(mockWs.closed).toBe(true)
      // expect(wsCore.getStatus()).toBe(WS_CORE_STATUS.CLOSED)
      expect(mockLogger.debug).toHaveBeenCalledWith('WebSocket 实例销毁')
    })

    test('销毁后操作无效', () => {
      wsCore = new WSCore({
        url: 'ws://localhost:8080',
        logger: mockLogger,
      })

      wsCore.destroy()

      // 销毁后的操作应该无效
      wsCore.connect()
      wsCore.send('test')
      wsCore.disconnect()
      wsCore.reconnect()

      expect(MockWebSocket.instances).toHaveLength(0)
    })
  })

  describe('动态URL', () => {
    test('使用函数动态获取URL', () => {
      const getUrl = jest.fn(() => 'ws://dynamic-url.com')

      wsCore = new WSCore({
        url: getUrl,
        logger: mockLogger,
      })

      wsCore.connect()

      expect(getUrl).toHaveBeenCalled()
      expect(MockWebSocket.latest?.url).toBe('ws://dynamic-url.com')
    })
  })
})
