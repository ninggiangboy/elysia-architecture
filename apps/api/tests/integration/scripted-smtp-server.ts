/**
 * A minimal SMTP server that answers like a provider on demand: accepts mail, or refuses the next recipient the way a
 * real server refuses a nonexistent mailbox (550) or a sender over its rate (454). Just enough of the protocol for nodemailer.
 */
export function startScriptedSmtpServer() {
  let nextRefusal: string | undefined
  const server = Bun.listen<{ buffer: string; inData: boolean }>({
    hostname: '127.0.0.1',
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: '', inData: false }
        socket.write('220 scripted.test ESMTP\r\n')
      },
      data(socket, chunk) {
        const state = socket.data
        state.buffer += chunk.toString()
        for (;;) {
          if (state.inData) {
            const end = state.buffer.indexOf('\r\n.\r\n')
            if (end === -1) return
            state.buffer = state.buffer.slice(end + 5)
            state.inData = false
            socket.write('250 2.0.0 Ok: queued\r\n')
            continue
          }
          const eol = state.buffer.indexOf('\r\n')
          if (eol === -1) return
          const line = state.buffer.slice(0, eol).toUpperCase()
          state.buffer = state.buffer.slice(eol + 2)
          if (line.startsWith('EHLO') || line.startsWith('HELO'))
            socket.write('250-scripted.test\r\n250 8BITMIME\r\n')
          else if (line.startsWith('RCPT')) {
            const refusal = nextRefusal
            nextRefusal = undefined
            socket.write(refusal ? `${refusal}\r\n` : '250 2.1.5 Ok\r\n')
          } else if (line === 'DATA') {
            state.inData = true
            socket.write('354 End data with <CR><LF>.<CR><LF>\r\n')
          } else if (line === 'QUIT') {
            socket.write('221 Bye\r\n')
            socket.end()
          } else socket.write('250 Ok\r\n')
        }
      },
    },
  })
  return {
    port: server.port,
    refuseNextRecipientAsMissingMailbox() {
      nextRefusal = '550 5.1.1 The email account that you tried to reach does not exist'
    },
    refuseNextRecipientAsThrottled() {
      nextRefusal = '454 4.7.0 Throttling failure: Maximum sending rate exceeded'
    },
    stop: () => server.stop(true),
  }
}
