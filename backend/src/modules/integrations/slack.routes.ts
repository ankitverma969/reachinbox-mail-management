import { Router } from 'express';
import { slackController } from './slack.controller.js';

const router = Router();

// Initiate Slack OAuth 2.0 flow
router.get('/authorize', (req, res, next) => slackController.authorize(req, res, next));

// Slack OAuth 2.0 callback endpoint
router.get('/callback', (req, res, next) => slackController.callback(req, res, next));

// Retrieve active Slack connection status
router.get('/status', (req, res, next) => slackController.getStatus(req, res, next));

// Disconnect active Slack integration
router.delete('/disconnect', (req, res, next) => slackController.disconnect(req, res, next));

// Dispatch test notification to Slack
router.post('/test', (req, res, next) => slackController.sendTestNotification(req, res, next));

export const slackRoutes = router;
