import { useEffect } from 'react'
import { WSCore } from 'lll-websocket'

export default function Home() {
  useEffect(() => {
    const ws = new WSCore({
      url: 'http://localhost:9100',
      // @ts-ignore
      logger: console,
      heartbeatOptions: {
        enabled: true,
        interval: 20000,
        timeout: 70000,
        message: 'heartbeat',
        isHeartbeat: (data) => data === 'heartbeat',
      },
    })

    ws.connect()

    return () => void ws.destroy()
  }, [])

  return <div></div>
}
