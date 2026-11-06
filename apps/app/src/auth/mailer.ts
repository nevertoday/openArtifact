export interface OutgoingEmail {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>
}

/** Prints mail to the Worker log, so local sign-in works by copying the link from the terminal. */
export class ConsoleMailer implements Mailer {
  async send(email: OutgoingEmail): Promise<void> {
    console.log(`\n[mail] To: ${email.to}\n[mail] Subject: ${email.subject}\n${email.text}\n`)
  }
}

/**
 * Used when no mail service is configured. Sign-in links must never land in a production log, where
 * anyone who reads the logs could sign in as anyone, so sending fails instead.
 */
export class UnconfiguredMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error('No mail service is configured. Set MAILER=console for local development.')
  }
}

export class Mailers {
  static fromSetting(mailerSetting: string | undefined): Mailer {
    return mailerSetting === 'console' ? new ConsoleMailer() : new UnconfiguredMailer()
  }
}
