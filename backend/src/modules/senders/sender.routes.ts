import { Router } from 'express';
import { senderController } from './sender.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

const router = Router();

router.get('/', requireAuth, (req, res, next) => senderController.listSenders(req, res, next));
router.post('/', requireAuth, (req, res, next) => senderController.createSender(req, res, next));
router.patch('/:id', requireAuth, (req, res, next) => senderController.updateSender(req, res, next));

export const senderRoutes = router;
