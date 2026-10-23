import { Client, type ClientOptions } from '@elastic/elasticsearch';
import { env } from './environment.config.js';
import { logger } from '../shared/logger/structured-logger.js';

let esClientInstance: Client | null = null;

export function getElasticsearchClientOptions(): ClientOptions {
  const node = env.ELASTICSEARCH_NODE || env.ELASTICSEARCH_URL || 'http://localhost:9200';
  const options: ClientOptions = {
    node,
    maxRetries: 0,
    requestTimeout: 2000,
    sniffOnStart: false
  };

  if (env.ELASTICSEARCH_API_KEY) {
    options.auth = { apiKey: env.ELASTICSEARCH_API_KEY };
  } else if (env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD) {
    options.auth = {
      username: env.ELASTICSEARCH_USERNAME,
      password: env.ELASTICSEARCH_PASSWORD
    };
  }

  return options;
}

export function getElasticsearchClient(): Client {
  if (!esClientInstance) {
    const options = getElasticsearchClientOptions();
    esClientInstance = new Client(options);
  }
  return esClientInstance;
}

/**
 * Lightweight, non-blocking health check probing Elasticsearch availability.
 */
export async function checkElasticsearchHealth(): Promise<boolean> {
  const client = getElasticsearchClient();
  try {
    const pingPromise = client.ping();
    const timeoutPromise = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error('Elasticsearch ping timeout')), 1000)
    );

    const response = await Promise.race([pingPromise, timeoutPromise]);
    return response === true;
  } catch {
    return false;
  }
}

export async function closeElasticsearchClient(): Promise<void> {
  if (esClientInstance) {
    try {
      await esClientInstance.close();
    } catch (err) {
      logger.error({ err }, 'Error closing Elasticsearch client');
    } finally {
      esClientInstance = null;
    }
  }
}
