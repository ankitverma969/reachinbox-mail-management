import { Router } from 'express';
import { authController } from './auth.controller.js';
import { requireAuth } from '../../middleware/auth.middleware.js';

const router = Router();

// Google OAuth 2.0 flow
router.get('/google', (req, res, next) => authController.initiateGoogleLogin(req, res, next));
router.get('/google/callback', (req, res, next) => authController.handleGoogleCallback(req, res, next));

// Session endpoints
router.get('/me', requireAuth, (req, res, next) => authController.getCurrentUser(req, res, next));
router.post('/logout', (req, res) => authController.logout(req, res));

// Local development / fallback testing endpoint
router.post('/dev-login', (req, res, next) => authController.devLogin(req, res, next));

export const authRoutes = router;
