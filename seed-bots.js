// Seed bot accounts and activity for testing
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Random name generators
const firstNames = [
  'Alex', 'Jordan', 'Taylor', 'Morgan', 'Casey', 'Riley', 'Quinn', 'Avery', 'Skyler', 'Dakota',
  'Phoenix', 'River', 'Sage', 'Rowan', 'Finley', 'Emery', 'Hayden', 'Reese', 'Parker', 'Blake',
  'Cameron', 'Drew', 'Jamie', 'Kendall', 'Logan', 'Peyton', 'Sawyer', 'Spencer', 'Sydney', 'Tatum',
  'Kai', 'Zion', 'Nova', 'Luna', 'Aria', 'Milo', 'Leo', 'Theo', 'Ivy', 'Cleo',
  'Max', 'Sam', 'Charlie', 'Frankie', 'Jesse', 'Robin', 'Ash', 'Eden', 'Jade', 'Remy',
  'Nico', 'Ellis', 'Harley', 'Marley', 'Oakley', 'Lennon', 'Marlowe', 'Shiloh', 'Sutton', 'Wren',
  'Zara', 'Kira', 'Nyla', 'Mika', 'Yuki', 'Hana', 'Sora', 'Ren', 'Jin', 'Yuna',
  'Luca', 'Ezra', 'Jude', 'Felix', 'Oscar', 'Hugo', 'Mia', 'Zoe', 'Lily', 'Ruby'
];

const lastNames = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
  'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  'Green', 'Adams', 'Nelson', 'Baker', 'Hall', 'Rivera', 'Campbell', 'Mitchell', 'Carter', 'Roberts'
];

const adjectives = ['Happy', 'Cool', 'Epic', 'Pro', 'Swift', 'Ninja', 'Pixel', 'Turbo', 'Ultra', 'Mega', 'Super', 'Hyper', 'Cyber', 'Neon', 'Retro'];
const nouns = ['Gamer', 'Player', 'Master', 'King', 'Queen', 'Legend', 'Hero', 'Star', 'Wolf', 'Fox', 'Dragon', 'Phoenix', 'Tiger', 'Hawk', 'Bear'];

// Avatar - just use null to show default app icon
const getAvatarUrl = (seed) => null;

// Generate random username
const generateUsername = () => {
  const style = Math.random();
  if (style < 0.4) {
    // firstname + numbers
    const name = firstNames[Math.floor(Math.random() * firstNames.length)];
    const num = Math.floor(Math.random() * 9999);
    return `${name.toLowerCase()}${num}`;
  } else if (style < 0.7) {
    // adjective + noun + numbers
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 999);
    return `${adj}${noun}${num}`.toLowerCase();
  } else {
    // firstname + lastname initial + numbers
    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    const num = Math.floor(Math.random() * 99);
    return `${first.toLowerCase()}_${last[0].toLowerCase()}${num}`;
  }
};

// Generate display name
const generateDisplayName = () => {
  const first = firstNames[Math.floor(Math.random() * firstNames.length)];
  if (Math.random() > 0.5) {
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return `${first} ${last}`;
  }
  return first;
};

// Generate bio
const bios = [
  '🎮 Gaming is life',
  'Just here to play games',
  'High score hunter 🏆',
  'Casual gamer vibes',
  'Addicted to mobile games',
  'Beat my high score if you can!',
  '🔥 On a streak',
  'Pro gamer in training',
  'Games > Everything',
  'Level up every day',
  '',
  '',
  '',
];

async function seedBots(count = 100) {
  const client = await pool.connect();
  
  try {
    console.log(`🤖 Creating ${count} bot accounts...`);
    
    // Get existing games
    const gamesResult = await client.query('SELECT id, name FROM games LIMIT 50');
    const games = gamesResult.rows;
    
    if (games.length === 0) {
      console.log('❌ No games found in database. Please seed games first.');
      return;
    }
    
    console.log(`📎 Found ${games.length} games to use for activity`);
    
    const botIds = [];
    const hashedPassword = await bcrypt.hash('botpassword123', 10);
    
    // Create bot users
    for (let i = 0; i < count; i++) {
      const username = generateUsername() + Math.floor(Math.random() * 1000);
      const displayName = generateDisplayName();
      const bio = bios[Math.floor(Math.random() * bios.length)];
      const avatar = getAvatarUrl(username);
      
      try {
        const result = await client.query(
          `INSERT INTO users (username, password, display_name, bio, avatar, games_played, total_score)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [username, hashedPassword, displayName, bio, avatar, Math.floor(Math.random() * 100), Math.floor(Math.random() * 50000)]
        );
        botIds.push(result.rows[0].id);
        
        // Initialize gamification tables for this user
        await client.query('INSERT INTO user_points (user_id, balance, lifetime_earned) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', 
          [result.rows[0].id, Math.floor(Math.random() * 5000), Math.floor(Math.random() * 10000)]);
        await client.query('INSERT INTO user_levels (user_id, xp, level) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [result.rows[0].id, Math.floor(Math.random() * 5000), Math.floor(Math.random() * 20) + 1]);
        await client.query('INSERT INTO user_streaks (user_id, current_streak, longest_streak) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
          [result.rows[0].id, Math.floor(Math.random() * 30), Math.floor(Math.random() * 60)]);
        
        if ((i + 1) % 20 === 0) {
          console.log(`  Created ${i + 1}/${count} users...`);
        }
      } catch (e) {
        // Username collision, skip
        continue;
      }
    }
    
    console.log(`✅ Created ${botIds.length} bot accounts`);
    
    // Create follows between bots
    console.log('👥 Creating follow relationships...');
    let followCount = 0;
    for (const botId of botIds) {
      // Each bot follows 5-20 random other bots
      const followsCount = Math.floor(Math.random() * 15) + 5;
      const toFollow = botIds.filter(id => id !== botId).sort(() => Math.random() - 0.5).slice(0, followsCount);
      
      for (const targetId of toFollow) {
        try {
          await client.query(
            'INSERT INTO followers (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [botId, targetId]
          );
          followCount++;
        } catch (e) {}
      }
    }
    console.log(`✅ Created ${followCount} follow relationships`);
    
    // Create likes
    console.log('❤️ Creating game likes...');
    let likeCount = 0;
    for (const botId of botIds) {
      // Each bot likes 3-15 random games
      const likesCount = Math.floor(Math.random() * 12) + 3;
      const toLike = games.sort(() => Math.random() - 0.5).slice(0, likesCount);
      
      for (const game of toLike) {
        try {
          await client.query(
            'INSERT INTO likes (user_id, game_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [botId, game.id]
          );
          likeCount++;
        } catch (e) {}
      }
    }
    console.log(`✅ Created ${likeCount} likes`);
    
    // Create scores
    console.log('🏆 Creating high scores...');
    let scoreCount = 0;
    for (const botId of botIds) {
      // Each bot has scores on 2-8 games
      const scoresCount = Math.floor(Math.random() * 6) + 2;
      const toScore = games.sort(() => Math.random() - 0.5).slice(0, scoresCount);
      
      for (const game of toScore) {
        const score = Math.floor(Math.random() * 10000) + 100;
        try {
          await client.query(
            'INSERT INTO scores (user_id, game_id, score) VALUES ($1, $2, $3)',
            [botId, game.id, score]
          );
          scoreCount++;
        } catch (e) {}
      }
    }
    console.log(`✅ Created ${scoreCount} scores`);
    
    // Create comments
    console.log('💬 Creating comments...');
    const commentTexts = [
      'This game is so addictive!',
      'Love it! 🔥',
      'Can\'t stop playing',
      'My new favorite',
      'Great game!',
      'So fun!',
      'Awesome!',
      'Best game ever',
      'Need more games like this',
      'Who else is addicted?',
      '10/10 would recommend',
      'Finally beat my high score!',
      'This is hard but fun',
      'Perfect for killing time',
      'Simple but addictive',
      '🎮🎮🎮',
      'Nice!',
      'Cool game',
      'Pretty good',
      'Not bad',
    ];
    
    let commentCount = 0;
    for (const botId of botIds.slice(0, 50)) { // Only 50 bots comment
      const commentsCount = Math.floor(Math.random() * 3) + 1;
      const toComment = games.sort(() => Math.random() - 0.5).slice(0, commentsCount);
      
      for (const game of toComment) {
        const text = commentTexts[Math.floor(Math.random() * commentTexts.length)];
        try {
          await client.query(
            'INSERT INTO comments (game_id, user_id, text, likes) VALUES ($1, $2, $3, $4)',
            [game.id, botId, text, Math.floor(Math.random() * 20)]
          );
          commentCount++;
        } catch (e) {}
      }
    }
    console.log(`✅ Created ${commentCount} comments`);
    
    // Update game stats
    console.log('📊 Updating game statistics...');
    await client.query(`
      UPDATE games g SET 
        like_count = (SELECT COUNT(*) FROM likes WHERE game_id = g.id),
        plays = plays + (SELECT COUNT(*) FROM scores WHERE game_id = g.id)
    `);
    
    console.log('\n🎉 Bot seeding complete!');
    console.log(`   - ${botIds.length} users`);
    console.log(`   - ${followCount} follows`);
    console.log(`   - ${likeCount} likes`);
    console.log(`   - ${scoreCount} scores`);
    console.log(`   - ${commentCount} comments`);
    
  } catch (e) {
    console.error('❌ Error seeding bots:', e);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run with: node seed-bots.js [count]
const count = parseInt(process.argv[2]) || 100;
seedBots(count);
