import admin from 'firebase-admin';

let firebaseInitialized = false;

const initializeFirebase = () => {
  if (firebaseInitialized) return;

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL
      }),
      projectId: process.env.FIREBASE_PROJECT_ID
    });
    firebaseInitialized = true;
    console.log('✅ Firebase Admin initialized');
  } catch (error) {
    console.error('❌ Firebase initialization error:', error);
  }
};

export const sendPushNotification = async (token, payload) => {
  const timestamp = new Date().toISOString();
  const orderId = payload.data?.orderId || 'unknown';
  const notificationType = payload.data?.type || 'SYSTEM_UPDATE';
  
  console.log(`[pushService] ========== Sending Push Notification ==========`);
  console.log(`[pushService] Timestamp: ${timestamp}`);
  console.log(`[pushService] Order ID: ${orderId}`);
  console.log(`[pushService] Notification Type: ${notificationType}`);
  console.log(`[pushService] Title: ${payload.title}`);
  console.log(`[pushService] Message: ${payload.message}`);
  console.log(`[pushService] Token (first 20 chars): ${token.substring(0, 20)}...`);
  console.log(`[pushService] Click Action: ${payload.clickAction || '/'}`);
  console.log(`[pushService] Full Payload:`, JSON.stringify(payload, null, 2));
  
  try {
    initializeFirebase();

    const message = {
      token: token,
      notification: {
        title: payload.title,
        body: payload.message
      },
      data: {
        orderId: payload.data?.orderId || '',
        type: payload.data?.type || 'SYSTEM_UPDATE',
        clickAction: payload.clickAction || '/'
      },
      webpush: {
        fcmOptions: {
          link: payload.clickAction || '/'
        },
        notification: {
          icon: '/pwa-192x192.png',
          badge: '/pwa-192x192.png',
          requireInteraction: true
        }
      },
      apns: {
        payload: {
          aps: {
            alert: {
              title: payload.title,
              body: payload.message
            },
            badge: 1,
            sound: 'default'
          }
        }
      }
    };

    console.log(`[pushService] FCM Message constructed, sending to Firebase...`);
    const response = await admin.messaging().send(message);
    console.log(`[pushService] ✅ Push notification sent successfully`);
    console.log(`[pushService] FCM Message ID: ${response}`);
    console.log(`[pushService] ========== Push Notification Sent Successfully ==========`);
    return { success: true, messageId: response };
  } catch (error) {
    console.error(`[pushService] ❌ Error sending push notification:`, error);
    console.error(`[pushService] Error code: ${error.code}`);
    console.error(`[pushService] Error message: ${error.message}`);
    
    // Handle specific Firebase errors
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.log(`[pushService] 🔄 Invalid token detected, will mark as inactive`);
      return { success: false, invalidToken: true, error: error.message };
    }
    
    return { success: false, error: error.message };
  }
};

export const sendToUser = async (userId, payload) => {
  const timestamp = new Date().toISOString();
  const orderId = payload.data?.orderId || 'unknown';
  
  console.log(`[pushService] ========== sendToUser Called ==========`);
  console.log(`[pushService] Timestamp: ${timestamp}`);
  console.log(`[pushService] User ID: ${userId}`);
  console.log(`[pushService] Order ID: ${orderId}`);
  console.log(`[pushService] Notification Type: ${payload.data?.type || 'SYSTEM_UPDATE'}`);
  
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Get all active subscriptions for the user
    console.log(`[pushService] Fetching active subscriptions for user ${userId}...`);
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        userId: userId,
        isActive: true
      }
    });

    console.log(`[pushService] Found ${subscriptions.length} active subscription(s) for user ${userId}`);
    
    if (subscriptions.length === 0) {
      console.log(`[pushService] ⚠️ No subscriptions found for user: ${userId}`);
      return { sent: 0, failed: 0, total: 0 };
    }

    // Log each subscription
    subscriptions.forEach((sub, index) => {
      console.log(`[pushService] Subscription ${index + 1}:`, {
        id: sub.id,
        deviceType: sub.deviceType,
        platform: sub.platform,
        tokenPrefix: sub.token.substring(0, 20) + '...'
      });
    });

    console.log(`[pushService] 📤 Sending push to ${subscriptions.length} device(s) for user ${userId}`);

    const results = await Promise.allSettled(
      subscriptions.map((sub, index) => {
        console.log(`[pushService] Sending to device ${index + 1}/${subscriptions.length} (${sub.deviceType}/${sub.platform})...`);
        return sendPushNotification(sub.token, payload);
      })
    );

    let sent = 0;
    let failed = 0;
    let invalidTokens = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        sent++;
        console.log(`[pushService] ✅ Device ${index + 1} sent successfully`);
      } else if (result.status === 'fulfilled' && result.value.invalidToken) {
        failed++;
        invalidTokens.push(subscriptions[index].id);
        console.log(`[pushService] ❌ Device ${index + 1} has invalid token`);
      } else {
        failed++;
        console.log(`[pushService] ❌ Device ${index + 1} failed:`, result.status === 'rejected' ? result.reason : result.value.error);
      }
    });

    // Deactivate invalid tokens
    if (invalidTokens.length > 0) {
      console.log(`[pushService] 🔄 Deactivating ${invalidTokens.length} invalid token(s)...`);
      await prisma.pushSubscription.updateMany({
        where: { id: { in: invalidTokens } },
        data: { isActive: false }
      });
      console.log(`[pushService] 🔄 Deactivated ${invalidTokens.length} invalid token(s)`);
    }

    console.log(`[pushService] ✅ Push notification summary for user ${userId}: ${sent}/${subscriptions.length} sent successfully`);
    console.log(`[pushService] ========== sendToUser Complete ==========`);
    
    return { sent, failed, total: subscriptions.length };
  } catch (error) {
    console.error(`[pushService] ❌ Error in sendToUser:`, error);
    console.error(`[pushService] Error stack:`, error.stack);
    return { sent: 0, failed: 0, total: 0, error: error.message };
  } finally {
    await prisma.$disconnect();
  }
};

export const sendToMultipleUsers = async (userIds, payload) => {
  const timestamp = new Date().toISOString();
  const orderId = payload.data?.orderId || 'unknown';
  
  console.log(`[pushService] ========== sendToMultipleUsers Called ==========`);
  console.log(`[pushService] Timestamp: ${timestamp}`);
  console.log(`[pushService] Number of users: ${userIds.length}`);
  console.log(`[pushService] Order ID: ${orderId}`);
  console.log(`[pushService] Notification Type: ${payload.data?.type || 'SYSTEM_UPDATE'}`);
  console.log(`[pushService] User IDs:`, userIds);
  
  console.log(`[pushService] 📤 Sending push to ${userIds.length} user(s)`);
  
  const results = await Promise.all(
    userIds.map((userId, index) => {
      console.log(`[pushService] Processing user ${index + 1}/${userIds.length} (${userId})...`);
      return sendToUser(userId, payload);
    })
  );

  const totals = results.reduce((acc, result) => ({
    sent: acc.sent + result.sent,
    failed: acc.failed + result.failed,
    total: acc.total + result.total
  }), { sent: 0, failed: 0, total: 0 });

  console.log(`[pushService] ✅ Bulk push summary: ${totals.sent}/${totals.total} sent successfully across ${userIds.length} user(s)`);
  console.log(`[pushService] ========== sendToMultipleUsers Complete ==========`);
  return totals;
};

