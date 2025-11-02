import express from 'express';
import { 
  getNotifications, 
  getUnreadCount, 
  markAsRead, 
  markAllAsRead, 
  deleteNotification 
} from '../controllers/notificationController.js';

const router = express.Router();

// GET /api/notifications/user/:userId - Get all notifications for a user
router.get('/user/:userId', getNotifications);

// GET /api/notifications/unread/:userId - Get unread count
router.get('/unread/:userId', getUnreadCount);

// PATCH /api/notifications/:id/read - Mark single notification as read
router.patch('/:id/read', markAsRead);

// PATCH /api/notifications/read-all/:userId - Mark all notifications as read
router.patch('/read-all/:userId', markAllAsRead);

// DELETE /api/notifications/:id - Delete notification
router.delete('/:id', deleteNotification);

export default router;

