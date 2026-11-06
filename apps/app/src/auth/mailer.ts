import type { AppEnv } from '../env.ts'

export interface OutgoingEmail {
  to: string
  subject: string
  text: string
}

export interface Mailer {
  send(email: OutgoingEmail): Promise<void>
}

/** A deployment chose a mail service but did not give it what it needs. */
export class MailerConfigError extends Error {}

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
    throw new Error('No mail service is configured. Set MAILER=console for local development or MAILER=cloudflare to send through Cloudflare Email Service.')
  }
}

/** Sends through the Cloudflare Email Service `send_email` binding, from the address in MAIL_FROM. */
export class CloudflareEmailMailer implements Mailer {
  readonly #emailBinding: SendEmail
  readonly #sender: string | EmailAddress

  constructor(emailBinding: SendEmail, mailFrom: string) {
    this.#emailBinding = emailBinding
    this.#sender = CloudflareEmailMailer.#senderOf(mailFrom)
  }

  async send(email: OutgoingEmail): Promise<void> {
    try {
      await this.#emailBinding.send({ from: this.#sender, to: email.to, subject: email.subject, text: email.text })
    } catch (error) {
      // The service's own message may quote the recipient, so the log line carries only the error code.
      throw new Error(`Cloudflare Email Service did not send the message: ${CloudflareEmailMailer.#reasonOf(error)}`, { cause: error })
    }
  }

  /** Accepts `Open Artifact <noreply@example.com>` or a plain `noreply@example.com`. */
  static #senderOf(mailFrom: string): string | EmailAddress {
    const plainAddress = /^[^\s<>@]+@[^\s<>@]+$/
    const namedAddress = /^(?<name>[^<>]*?)\s*<(?<email>[^\s<>@]+@[^\s<>@]+)>$/
    const trimmedMailFrom = mailFrom.trim()
    if (plainAddress.test(trimmedMailFrom)) return trimmedMailFrom
    const namedSender = namedAddress.exec(trimmedMailFrom)?.groups
    if (namedSender?.name && namedSender.email) return { name: namedSender.name, email: namedSender.email }
    throw new MailerConfigError(`MAIL_FROM must look like "Open Artifact <noreply@example.com>" or "noreply@example.com", not "${mailFrom}".`)
  }

  static #reasonOf(error: unknown): string {
    const code = error instanceof Error && 'code' in error ? error.code : undefined
    return typeof code === 'string' ? code : 'no error code'
  }
}

export type MailerEnv = Pick<AppEnv, 'MAILER' | 'EMAIL' | 'MAIL_FROM'>

export class Mailers {
  /** A chosen service missing its binding or sender fails here, on the first request, not at the first sign-in. */
  static fromEnv(mailerEnv: MailerEnv): Mailer {
    switch (mailerEnv.MAILER) {
      case undefined:
        return new UnconfiguredMailer()
      case 'console':
        return new ConsoleMailer()
      case 'cloudflare':
        return Mailers.#cloudflareEmailMailer(mailerEnv)
      default:
        throw new MailerConfigError(`MAILER="${mailerEnv.MAILER}" is not a mail service. Use "console" or "cloudflare".`)
    }
  }

  static #cloudflareEmailMailer({ EMAIL, MAIL_FROM }: MailerEnv): CloudflareEmailMailer {
    if (!EMAIL) throw new MailerConfigError('MAILER=cloudflare needs the "EMAIL" send_email binding in wrangler.jsonc.')
    if (!MAIL_FROM) throw new MailerConfigError('MAILER=cloudflare needs MAIL_FROM, a sender on a verified domain, such as "Open Artifact <noreply@example.com>".')
    return new CloudflareEmailMailer(EMAIL, MAIL_FROM)
  }
}
