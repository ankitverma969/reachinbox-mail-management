import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/environment.config.js';
import { logger } from '../../shared/logger/structured-logger.js';

export interface SendEmailOptions {
  from?: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  smtpConfig?: {
    host: string;
    port: number;
    user: string;
    pass: string;
  };
}

export interface SendEmailResult {
  messageId: string;
  smtpResponse: string;
  etherealPreviewUrl: string | null;
}

export class EtherealEmailService {
  private transporterCache = new Map<string, Transporter>();

  /**
   * Returns or initializes a Nodemailer transporter.
   * If custom SMTP configuration is provided, uses it.
   * Otherwise falls back to environment Ethereal configuration.
   */
  public getTransporter(config?: {
    host: string;
    port: number;
    user: string;
    pass: string;
  }): Transporter {
    const host = config?.host || env.ETHEREAL_HOST;
    const port = config?.port || env.ETHEREAL_PORT;
    const user = config?.user || env.ETHEREAL_USER;
    const pass = config?.pass || env.ETHEREAL_PASSWORD;

    if (!user || !pass) {
      throw new Error(
        'Ethereal SMTP credentials missing. Please configure ETHEREAL_USER and ETHEREAL_PASSWORD or provide sender SMTP credentials.'
      );
    }

    const cacheKey = `${host}:${port}:${user}`;
    const cached = this.transporterCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass
      },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000
    });

    this.transporterCache.set(cacheKey, transporter);
    return transporter;
  }

  /**
   * Verifies SMTP connection readiness without sending an email.
   */
  async verifyConnection(config?: {
    host: string;
    port: number;
    user: string;
    pass: string;
  }): Promise<boolean> {
    const transporter = this.getTransporter(config);
    try {
      await transporter.verify();
      return true;
    } catch (err) {
      logger.error({ err }, 'SMTP connection verification failed');
      return false;
    }
  }

  /**
   * Dispatches an email via SMTP and extracts delivery telemetry and preview URL.
   */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const transporter = this.getTransporter(options.smtpConfig);

    const fromAddress = options.from || options.smtpConfig?.user || env.ETHEREAL_USER;
    if (!fromAddress) {
      throw new Error('No sender address specified for email delivery');
    }

    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to: options.to,
        subject: options.subject,
        text: options.text || (options.html ? options.html.replace(/<[^>]+>/g, '') : ''),
        html: options.html
      });

      const etherealPreviewUrl = nodemailer.getTestMessageUrl(info);
      const previewUrlString = typeof etherealPreviewUrl === 'string' ? etherealPreviewUrl : null;

      logger.info(
        {
          messageId: info.messageId,
          recipient: options.to,
          previewUrl: previewUrlString
        },
        'Email successfully dispatched via SMTP'
      );

      return {
        messageId: info.messageId,
        smtpResponse: info.response || '250 OK',
        etherealPreviewUrl: previewUrlString
      };
    } catch (error) {
      const err = error as Error;
      logger.error(
        {
          recipient: options.to,
          errorMessage: err.message
        },
        'SMTP dispatch failed'
      );
      throw error;
    }
  }

  /**
   * Closes all cached transporters cleanly on shutdown.
   */
  close(): void {
    for (const transporter of this.transporterCache.values()) {
      transporter.close();
    }
    this.transporterCache.clear();
  }
}

export const etherealEmailService = new EtherealEmailService();
