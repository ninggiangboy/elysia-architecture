/** The realtime feature's messages in English, the source language (merged with every other feature's in `src/i18n`). */
export const en = {
  realtime: {
    title: 'Realtime',
    description:
      'A live Server-Sent Events stream fanned out through Postgres — no Redis, works across any number of API replicas.',
    sendTitle: 'Send a test event',
    sendDescription: 'It should show up in the event log within a moment.',
    message: 'Test message',
    send: 'Send',
    sendLabel: 'Send test event',
    howTitle: 'How it travels',
    stepApi: 'API',
    stepApiText: 'Your test event is written to the outbox.',
    stepPostgres: 'Postgres',
    stepPostgresText: 'The relay publishes it with LISTEN/NOTIFY.',
    stepReplicas: 'Every replica',
    stepReplicasText: 'Each API instance pushes it to the streams it holds.',
    tip: 'Tip: sign in on a second device, then sign it out from the Profile page to watch the session events arrive.',
    log: 'Event log',
    logDescription:
      'One-way stream over HTTP (fetch + Authorization header). Reconnects by itself.',
    clear: 'Clear log',
    disconnect: 'Disconnect',
    connect: 'Connect',
    noEvents: 'No events yet. Send a test event to see it here.',
    status: {
      open: 'open',
      connecting: 'connecting',
      reconnecting: 'reconnecting',
      closed: 'closed',
    },
  },
} as const
