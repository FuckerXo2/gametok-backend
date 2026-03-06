// Send a test notification to yourself
// Usage: node send-test-notification.js YOUR_AUTH_TOKEN

const authToken = process.argv[2];

if (!authToken) {
  console.error('Usage: node send-test-notification.js YOUR_AUTH_TOKEN');
  console.error('Get your token from AsyncStorage or login response');
  process.exit(1);
}

const API_URL = 'https://gametok-backend-production.up.railway.app';

async function sendTestNotification() {
  try {
    const response = await fetch(`${API_URL}/api/notifications/test`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Success:', data.message);
      console.log('Check your phone for the notification!');
    } else {
      console.error('❌ Error:', data.error);
    }
  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
}

sendTestNotification();
