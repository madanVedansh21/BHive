import { useEffect, useRef } from 'react'
import { useBHiveStore } from '../store/bhiveStore'
import { BHiveEvent } from '../types'

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:4242'
  : `ws://${window.location.host}`

const RECONNECT_DELAY_MS = 3000

export function useWebSocket() {
  const handleEvent = useBHiveStore((s) => s.handleEvent)
  const setConnected = useBHiveStore((s) => s.setConnected)
  const setWsSend = useBHiveStore((s) => s.setWsSend)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let unmounted = false

    function connect() {
      if (unmounted) return
      const ws = new WebSocket(WS_URL)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        setWsSend((msg: object) => ws.send(JSON.stringify(msg)))
        console.log('[WS] Connected')
      }

      ws.onmessage = (e) => {
        try {
          const event: BHiveEvent = JSON.parse(e.data)
          handleEvent(event)
        } catch {
          // ignore malformed
        }
      }

      ws.onclose = () => {
        setConnected(false)
        setWsSend((_msg: object) => {})
        if (!unmounted) {
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY_MS)
        }
        console.log('[WS] Disconnected, reconnecting...')
      }

      ws.onerror = () => {
        ws.close()
      }
    }

    connect()

    return () => {
      unmounted = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [])
}
