import type { estypes } from '@elastic/elasticsearch';
import { getElasticsearchClient, checkElasticsearchHealth } from '../../config/elasticsearch.config.js';
import { env } from '../../config/environment.config.js';
import { prisma } from '../../shared/database/prisma.client.js';
import { ServiceUnavailableError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/logger/structured-logger.js';
import type { EmailJobStatus, Prisma } from '@prisma/client';

type EmailJobWithSender = Prisma.EmailJobGetPayload<{
  include: {
    sender: { select: { userId: true; emailAddress: true } };
  };
}>;

export interface EmailJobDocument {
  emailJobId: string;
  userId: string;
  senderId: string;
  senderEmail?: string;
  batchId?: string | null;
  recipientEmail: string;
  subject: string;
  body: string;
  status: EmailJobStatus;
  scheduledAt: string;
  sentAt?: string | null;
  failedAt?: string | null;
  rescheduledAt?: string | null;
  idempotencyKey: string;
  smtpMessageId?: string | null;
  etherealPreviewUrl?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SearchEmailParams {
  userId: string;
  q?: string;
  status?: string;
  senderId?: string;
  batchId?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface SearchResultItem {
  id: string;
  emailJobId: string;
  recipientEmail: string;
  subject: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  senderId: string;
  senderEmail?: string;
  etherealPreviewUrl?: string | null;
  highlights?: Record<string, string[]>;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  tookMs: number;
}

export interface ReindexResult {
  totalProcessed: number;
  indexedCount: number;
  failedCount: number;
}

export class EmailSearchIndexService {
  private indexName = `${env.ELASTICSEARCH_INDEX_PREFIX}-emails`;
  private isIndexInitialized = false;

  public getIndexName(): string {
    return this.indexName;
  }

  /**
   * Initializes the Elasticsearch index with appropriate full-text and keyword mappings if not present.
   */
  async ensureIndexExists(): Promise<boolean> {
    const isOnline = await checkElasticsearchHealth();
    if (!isOnline) {
      logger.warn('Elasticsearch is currently unreachable; skipping index initialization');
      return false;
    }

    try {
      const client = getElasticsearchClient();
      const exists = await client.indices.exists({ index: this.indexName });

      if (!exists) {
        await client.indices.create({
          index: this.indexName,
          settings: {
            number_of_shards: 1,
            number_of_replicas: 0,
            analysis: {
              analyzer: {
                email_analyzer: {
                  type: 'custom',
                  tokenizer: 'uax_url_email',
                  filter: ['lowercase']
                }
              }
            }
          },
          mappings: {
            properties: {
              emailJobId: { type: 'keyword' },
              userId: { type: 'keyword' },
              senderId: { type: 'keyword' },
              senderEmail: { type: 'keyword' },
              batchId: { type: 'keyword' },
              recipientEmail: {
                type: 'text',
                analyzer: 'email_analyzer',
                fields: {
                  keyword: { type: 'keyword' }
                }
              },
              subject: {
                type: 'text',
                analyzer: 'standard'
              },
              body: {
                type: 'text',
                analyzer: 'standard'
              },
              status: { type: 'keyword' },
              scheduledAt: { type: 'date' },
              sentAt: { type: 'date' },
              failedAt: { type: 'date' },
              rescheduledAt: { type: 'date' },
              idempotencyKey: { type: 'keyword' },
              smtpMessageId: { type: 'keyword' },
              etherealPreviewUrl: { type: 'keyword' },
              errorMessage: { type: 'text' },
              createdAt: { type: 'date' },
              updatedAt: { type: 'date' }
            }
          }
        });
        logger.info({ index: this.indexName }, 'Elasticsearch index created with schema mappings');
      }

      this.isIndexInitialized = true;
      return true;
    } catch (err) {
      logger.error({ err }, 'Error checking/creating Elasticsearch index');
      return false;
    }
  }

  /**
   * Idempotently indexes a single email job document using emailJobId as document ID.
   */
  async indexEmailJob(doc: EmailJobDocument): Promise<void> {
    const isOnline = await checkElasticsearchHealth();
    if (!isOnline) {
      logger.debug({ emailJobId: doc.emailJobId }, 'Elasticsearch offline; skipping real-time document indexing');
      return;
    }

    try {
      if (!this.isIndexInitialized) {
        await this.ensureIndexExists();
      }

      const client = getElasticsearchClient();
      await client.index({
        index: this.indexName,
        id: doc.emailJobId,
        document: doc,
        refresh: false
      });
    } catch (err) {
      // Non-blocking failure: PostgreSQL remains source of truth
      logger.warn(
        { emailJobId: doc.emailJobId, error: (err as Error).message },
        'Elasticsearch indexing failed; database record preserved'
      );
    }
  }

  /**
   * Bulk indexes multiple email job documents in a single HTTP request.
   */
  async indexBatch(docs: EmailJobDocument[]): Promise<void> {
    if (docs.length === 0) return;

    const isOnline = await checkElasticsearchHealth();
    if (!isOnline) {
      logger.debug({ count: docs.length }, 'Elasticsearch offline; skipping real-time batch indexing');
      return;
    }

    try {
      if (!this.isIndexInitialized) {
        await this.ensureIndexExists();
      }

      const client = getElasticsearchClient();
      const operations = docs.flatMap((doc) => [
        { index: { _index: this.indexName, _id: doc.emailJobId } },
        doc
      ]);

      const response = await client.bulk({ refresh: false, operations });
      if (response.errors) {
        logger.warn('Some items failed to bulk index into Elasticsearch');
      }
    } catch (err) {
      logger.warn(
        { count: docs.length, error: (err as Error).message },
        'Elasticsearch bulk index failed; database records preserved'
      );
    }
  }

  /**
   * Updates fields of an indexed email document (e.g. status transition, sentAt, previewUrl).
   */
  async updateStatus(
    emailJobId: string,
    updates: Partial<EmailJobDocument>
  ): Promise<void> {
    const isOnline = await checkElasticsearchHealth();
    if (!isOnline) {
      logger.debug({ emailJobId }, 'Elasticsearch offline; skipping real-time status update');
      return;
    }

    try {
      const client = getElasticsearchClient();
      await client.update({
        index: this.indexName,
        id: emailJobId,
        doc: {
          ...updates,
          updatedAt: new Date().toISOString()
        },
        doc_as_upsert: false
      });
    } catch (err) {
      logger.warn(
        { emailJobId, error: (err as Error).message },
        'Elasticsearch status update failed; database remains source of truth'
      );
    }
  }

  /**
   * Executes a full-text and filtered search strictly scoped to the authenticated user's tenant.
   */
  async searchEmails(params: SearchEmailParams): Promise<SearchResult> {
    const isOnline = await checkElasticsearchHealth();
    if (!isOnline) {
      throw new ServiceUnavailableError(
        'Search service is currently unavailable. Please verify Elasticsearch status or try again shortly.'
      );
    }

    const client = getElasticsearchClient();
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.max(1, Math.min(100, params.limit ?? 20));
    const from = (page - 1) * limit;

    // 1. Mandatory tenant isolation filter
    const mustFilters: estypes.QueryDslQueryContainer[] = [
      { term: { userId: { value: params.userId } } }
    ];

    // 2. Full-text search across subject, recipientEmail, body
    if (params.q && params.q.trim().length > 0) {
      mustFilters.push({
        multi_match: {
          query: params.q.trim(),
          fields: ['subject^3', 'recipientEmail^2', 'body'],
          type: 'best_fields',
          fuzziness: 'AUTO'
        }
      });
    }

    // 3. Facet filters
    if (params.status) {
      mustFilters.push({ term: { status: { value: params.status } } });
    }
    if (params.senderId) {
      mustFilters.push({ term: { senderId: { value: params.senderId } } });
    }
    if (params.batchId) {
      mustFilters.push({ term: { batchId: { value: params.batchId } } });
    }

    // 4. Date range filter
    if (params.from || params.to) {
      const dateRange: Record<string, string> = {};
      if (params.from) dateRange.gte = new Date(params.from).toISOString();
      if (params.to) dateRange.lte = new Date(params.to).toISOString();
      mustFilters.push({ range: { scheduledAt: dateRange } });
    }

    // 5. Sort definition
    const sortField = params.sortBy === 'sentAt' ? 'sentAt' : 'scheduledAt';
    const sortOrder = params.sortOrder === 'asc' ? 'asc' : 'desc';

    const esResponse = await client.search<EmailJobDocument>({
      index: this.indexName,
      from,
      size: limit,
      query: {
        bool: {
          must: mustFilters
        }
      },
      sort: [
        { [sortField]: { order: sortOrder, missing: '_last' } },
        { emailJobId: { order: 'asc' } } // Stable tie-breaker
      ],
      highlight: {
        fields: {
          subject: {},
          body: {}
        }
      }
    });

    const hits = esResponse.hits.hits;
    const totalCount =
      typeof esResponse.hits.total === 'number'
        ? esResponse.hits.total
        : esResponse.hits.total?.value || 0;

    const items: SearchResultItem[] = hits.map((hit) => {
      const source = hit._source!;
      return {
        id: source.emailJobId,
        emailJobId: source.emailJobId,
        recipientEmail: source.recipientEmail,
        subject: source.subject,
        status: source.status,
        scheduledAt: source.scheduledAt,
        sentAt: source.sentAt,
        senderId: source.senderId,
        senderEmail: source.senderEmail,
        etherealPreviewUrl: source.etherealPreviewUrl,
        highlights: hit.highlight as Record<string, string[]> | undefined
      };
    });

    return {
      items,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit) || 1,
      tookMs: esResponse.took
    };
  }

  /**
   * Administrative reindex operation: reads all records from PostgreSQL in batches
   * and populates/rebuilds Elasticsearch documents.
   */
  async reindexFromDatabase(options?: {
    batchSize?: number;
    userId?: string;
  }): Promise<ReindexResult> {
    const isOnline = await checkElasticsearchHealth();
    if (!isOnline) {
      throw new ServiceUnavailableError('Cannot reindex: Elasticsearch is currently unreachable');
    }

    await this.ensureIndexExists();

    const batchSize = Math.max(10, Math.min(1000, options?.batchSize ?? 500));
    let cursor: string | undefined = undefined;
    let totalProcessed = 0;
    let indexedCount = 0;
    let failedCount = 0;

    logger.info('Starting full database-to-Elasticsearch reindex pass...');

    while (true) {
      const jobs: EmailJobWithSender[] = await prisma.emailJob.findMany({
        take: batchSize,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        where: options?.userId ? { sender: { userId: options.userId } } : undefined,
        orderBy: { id: 'asc' },
        include: {
          sender: { select: { userId: true, emailAddress: true } }
        }
      });

      if (jobs.length === 0) {
        break;
      }

      const documents: EmailJobDocument[] = jobs.map((job: EmailJobWithSender) => ({
        emailJobId: job.id,
        userId: job.sender.userId,
        senderId: job.senderId,
        senderEmail: job.sender.emailAddress,
        batchId: job.batchId,
        recipientEmail: job.recipientEmail,
        subject: job.subject,
        body: job.body,
        status: job.status,
        scheduledAt: job.scheduledAt.toISOString(),
        sentAt: job.sentAt?.toISOString() || null,
        failedAt: job.failedAt?.toISOString() || null,
        rescheduledAt: job.rescheduledAt?.toISOString() || null,
        idempotencyKey: job.idempotencyKey,
        smtpMessageId: job.smtpMessageId,
        etherealPreviewUrl: job.etherealPreviewUrl,
        errorMessage: job.errorMessage,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString()
      }));

      try {
        await this.indexBatch(documents);
        indexedCount += documents.length;
      } catch {
        failedCount += documents.length;
      }

      totalProcessed += jobs.length;
      const lastJob = jobs[jobs.length - 1];
      if (!lastJob) {
        break;
      }
      cursor = lastJob.id;

      if (jobs.length < batchSize) {
        break;
      }
    }

    logger.info(
      { totalProcessed, indexedCount, failedCount },
      'Elasticsearch reindex pass completed'
    );

    return { totalProcessed, indexedCount, failedCount };
  }
}

export const emailSearchIndexService = new EmailSearchIndexService();
