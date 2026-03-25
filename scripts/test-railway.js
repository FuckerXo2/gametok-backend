import fetch from 'node-fetch';
import fs from 'fs';

async function test() {
  try {
    const API_URL = 'https://gametok-backend-production.up.railway.app/api';
    const signupRes = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        username: 'testai_' + Date.now(), 
        password: 'password123',
        email: 'testai_' + Date.now() + '@test.com'
      })
    });
    
    const signupData = await signupRes.json();
    if (!signupData.token) return;
    
    const token = signupData.token;
    const dreamRes = await fetch(`${API_URL}/ai/dream`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ prompt: "A relaxing color-matching puzzle game with chain combos" })
    });
    
    const text = await dreamRes.text();
    const json = JSON.parse(text);
    if (json.htmlPreview) {
      fs.writeFileSync('/tmp/game.html', json.htmlPreview);
      console.log('Saved to /tmp/game.html');
    }
  } catch(e) {
    console.error('Test failed:', e);
  }
}

test();
