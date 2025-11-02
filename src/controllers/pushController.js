import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Subscribe to push notifications
export const subscribe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token, userAgent, deviceType, platform } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    // Check if already subscribed with this token
    const existing = await prisma.pushSubscription.findUnique({
      where: { token }
    });

    if (existing) {
      // If token exists but for different user, update it
      if (existing.userId !== userId) {
        await prisma.pushSubscription.update({
          where: { token },
          data: {
            userId,
            userAgent,
            deviceType,
            platform,
            isActive: true,
            updatedAt: new Date()
          }
        });
        console.log('✅ Updated existing subscription for different user');
        return res.json({
          success: true,
          message: 'Subscription updated',
          data: existing
        });
      }

      // If already subscribed, just activate
      if (!existing.isActive) {
        await prisma.pushSubscription.update({
          where: { token },
          data: { isActive: true }
        });
        console.log('✅ Reactivated existing subscription');
      }

      return res.json({
        success: true,
        message: 'Already subscribed',
        data: existing
      });
    }

    // Create new subscription
    const subscription = await prisma.pushSubscription.create({
      data: {
        userId,
        token,
        userAgent,
        deviceType,
        platform
      }
    });

    console.log('✅ New push subscription created');
    res.json({
      success: true,
      message: 'Subscribed to push notifications',
      data: subscription
    });
  } catch (error) {
    console.error('❌ Subscribe error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to subscribe to push notifications',
      error: error.message
    });
  }
};

// Unsubscribe from push notifications
export const unsubscribe = async (req, res) => {
  try {
    const userId = req.user.id;
    const { token } = req.body;

    if (token) {
      // Unsubscribe specific device
      const subscription = await prisma.pushSubscription.findFirst({
        where: { userId, token }
      });

      if (subscription) {
        await prisma.pushSubscription.update({
          where: { id: subscription.id },
          data: { isActive: false }
        });
        console.log('✅ Device unsubscribed:', token);
      }
    } else {
      // Unsubscribe all devices for this user
      await prisma.pushSubscription.updateMany({
        where: { userId },
        data: { isActive: false }
      });
      console.log('✅ All devices unsubscribed for user:', userId);
    }

    res.json({
      success: true,
      message: 'Unsubscribed from push notifications'
    });
  } catch (error) {
    console.error('❌ Unsubscribe error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unsubscribe',
      error: error.message
    });
  }
};

// Get user's subscription status
export const getSubscriptionStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
      select: {
        id: true,
        deviceType: true,
        platform: true,
        isActive: true,
        createdAt: true
      }
    });

    res.json({
      success: true,
      data: {
        subscriptions,
        totalDevices: subscriptions.length,
        activeDevices: subscriptions.filter(s => s.isActive).length
      }
    });
  } catch (error) {
    console.error('❌ Get subscription status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get subscription status',
      error: error.message
    });
  }
};

