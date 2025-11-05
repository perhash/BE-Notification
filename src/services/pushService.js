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
  try {
    initializeFirebase();

    // Send only data payload to prevent automatic notification display
    // Frontend will handle showing notifications manually
    const message = {
      token: token,
      data: {
        title: payload.title || '',
        body: payload.message || '',
        orderId: payload.data?.orderId || '',
        type: payload.data?.type || 'SYSTEM_UPDATE',
        clickAction: payload.clickAction || '/'
      },
      webpush: {
        fcmOptions: {
          link: payload.clickAction || '/'
        }
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: 'default',
            alert: {
              title: payload.title || '',
              body: payload.message || ''
            }
          }
        }
      }
    };

    const response = await admin.messaging().send(message);
    console.log('✅ Push notification sent successfully:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Error sending push notification:', error);
    
    // Handle specific Firebase errors
    if (error.code === 'messaging/invalid-registration-token' || 
        error.code === 'messaging/registration-token-not-registered') {
      console.log('🔄 Invalid token, marking as inactive');
      return { success: false, invalidToken: true, error: error.message };
    }
    
    return { success: false, error: error.message };
  }
};

export const sendToUser = async (userId, payload) => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  try {
    // Get all active subscriptions for the user
    const subscriptions = await prisma.pushSubscription.findMany({
      where: {
        userId: userId,
        isActive: true
      }
    });

    if (subscriptions.length === 0) {
      console.log('⚠️ No subscriptions found for user:', userId);
      return { sent: 0, failed: 0, total: 0 };
    }

    console.log(`📤 Sending push to ${subscriptions.length} devices for user ${userId}`);

    const results = await Promise.allSettled(
      subscriptions.map(sub => sendPushNotification(sub.token, payload))
    );

    let sent = 0;
    let failed = 0;
    let invalidTokens = [];

    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        sent++;
      } else if (result.status === 'fulfilled' && result.value.invalidToken) {
        failed++;
        invalidTokens.push(subscriptions[index].id);
      } else {
        failed++;
      }
    });

    // Deactivate invalid tokens
    if (invalidTokens.length > 0) {
      await prisma.pushSubscription.updateMany({
        where: { id: { in: invalidTokens } },
        data: { isActive: false }
      });
      console.log(`🔄 Deactivated ${invalidTokens.length} invalid tokens`);
    }

    console.log(`✅ Push notification summary: ${sent}/${subscriptions.length} sent successfully`);
    
    return { sent, failed, total: subscriptions.length };
  } catch (error) {
    console.error('❌ Error in sendToUser:', error);
    return { sent: 0, failed: 0, total: 0, error: error.message };
  } finally {
    await prisma.$disconnect();
  }
};

export const sendToMultipleUsers = async (userIds, payload) => {
  console.log(`📤 Sending push to ${userIds.length} users`);
  
  const results = await Promise.all(
    userIds.map(userId => sendToUser(userId, payload))
  );

  const totals = results.reduce((acc, result) => ({
    sent: acc.sent + result.sent,
    failed: acc.failed + result.failed,
    total: acc.total + result.total
  }), { sent: 0, failed: 0, total: 0 });

  console.log(`✅ Bulk push summary: ${totals.sent}/${totals.total} sent successfully`);
  return totals;
};

