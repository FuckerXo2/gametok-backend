/**
 * Seed OpenPigeon Basketball web game to database
 */
const API_URL = 'https://gametok-backend-production.up.railway.app';

async function seedBasketball() {
  const game = {
    id: 'basketball_web',
    name: 'Basketball (Web)',
    description: 'Score as many baskets as you can in 45 seconds! Swipe up to shoot.',
    thumbnail: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/openpigeon-basketball/backboard.png',
    embedUrl: 'https://pub-b7694276c8f54290854b276638a93b62.r2.dev/openpigeon-basketball/index.html',
    category: 'sports',
    icon: '🏀',
    color: '#FF6B35',
    multiplayerOnly: true
  };

  try {
    const res = await fetch(`${API_URL}/api/admin/games`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(game)
    });
    
    if (res.ok) {
      console.log('✅ OpenPigeon Basketball added to database');
    } else {
      const err = await res.text();
      console.error('❌ Failed:', err);
    }
  } catch (e) {
    console.error('❌ Error:', e.message);
  }
}

seedBasketball();
