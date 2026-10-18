export interface Mailer {
  send(mail: { to: string; subject: string; text: string; html: string }): Promise<void>
}
