// Send test notification to the most recent user
import pg from 'pg';
import { sendPushNotification } from './src/notifications.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function sendToLatestUser() {
  try {
    // Get the most recent user
    const result = await pool.query(
      'SELECT id, username FROM users ORDER BY created_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      console.log('No users found in database');
      return;
    }

    const user = result.rows[0];
    console.log(`Sending test notification to: ${user.username}`);

    await sendPushNotification(
      [user.id],
      '🎮 Test Notification',
      'If you see this, push notifications are working!',
      { type: 'test' }
    );

    console.log('✅ Notification sent! Check your phone.');
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await pool.end();
  }
}

sendToLatestUser();
