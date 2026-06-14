import { NextResponse } from 'next/server'
import { authenticateAgent } from '@/lib/agent/auth'

export async function GET(request: Request) {
  try {
    const authResult = await authenticateAgent(request)
    if (authResult.error || !authResult.userId) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status || 401 })
    }
    
    // Create a TransformStream for SSE
    const stream = new TransformStream()
    const writer = stream.writable.getWriter()

    // Keep-alive interval
    const interval = setInterval(() => {
      writer.write(new TextEncoder().encode(':keepalive\n\n'))
    }, 30000)

    // Disconnect handler
    request.signal.addEventListener('abort', () => {
      clearInterval(interval)
      writer.close()
    })

    // Simulated initial event
    writer.write(new TextEncoder().encode(`event: connected\ndata: {"status":"listening"}\n\n`))

    return new NextResponse(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    })
  } catch (err) {
    console.error('[agent/events] GET exception:', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
