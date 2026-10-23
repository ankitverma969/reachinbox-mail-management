import { Router } from 'express';
import { emailSchedulingController } from './email-scheduling.controller.js';
import { optionalAuth } from '../../middleware/auth.middleware.js';

const router = Router();

// Schedule an outreach email campaign / batch
router.post('/schedule', optionalAuth, (req, res, next) => emailSchedulingController.schedule(req, res, next));

// List scheduled outreach emails
router.get('/scheduled', optionalAuth, (req, res, next) => emailSchedulingController.getScheduled(req, res, next));

// List delivered and failed outreach emails
router.get('/sent', optionalAuth, (req, res, next) => emailSchedulingController.getSent(req, res, next));

// Get single email details by ID
router.get('/:id', optionalAuth, (req, res, next) => emailSchedulingController.getById(req, res, next));

// Cancel a scheduled outreach email
router.delete('/scheduled/:id', optionalAuth, (req, res, next) => emailSchedulingController.cancel(req, res, next));

export const emailSchedulingRoutes = router;
