import express from 'express';
import { 
  subscribe, 
  unsubscribe, 
  getSubscriptionStatus 
} from '../controllers/pushController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All push routes require authentication
router.use(authenticateToken);

// POST /api/push/subscribe - Subscribe to push notifications
router.post('/subscribe', subscribe);

// POST /api/push/unsubscribe - Unsubscribe from push notifications
router.post('/unsubscribe', unsubscribe);

// GET /api/push/status - Get user's subscription status
router.get('/status', getSubscriptionStatus);

export default router;

