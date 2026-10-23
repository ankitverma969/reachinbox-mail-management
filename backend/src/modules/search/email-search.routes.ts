import { Router } from 'express';
import { emailSearchController } from './email-search.controller.js';
import { adminAuthMiddleware } from '../../middleware/admin-auth.middleware.js';
import { optionalAuth } from '../../middleware/auth.middleware.js';

const router = Router();

// Full-text & filtered email search
router.get('/search', optionalAuth, (req, res, next) => emailSearchController.search(req, res, next));

// Administrative reindex
router.post('/reindex', adminAuthMiddleware, (req, res, next) =>
  emailSearchController.reindex(req, res, next)
);

export const emailSearchRoutes = router;
