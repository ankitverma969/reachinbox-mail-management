import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { emailQueueProducer } from '../../queues/email-queue.producer.js';
import type { Router } from 'express';

export function setupBullBoard(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const queue = emailQueueProducer.getQueue();

  createBullBoard({
    queues: [new BullMQAdapter(queue)],
    serverAdapter
  });

  return serverAdapter.getRouter();
}
