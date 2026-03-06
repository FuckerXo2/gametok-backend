// Assign random 3D creator avatars to ALL existing users
// Run with: DATABASE_URL=your_url node assign-avatars.js
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// All available avatar IDs (must match avatarData.ts in the frontend)
const AVATAR_IDS = [
    'default_3d',
    'light_curly',
    'light_straight',
    'light_buzz',
    'light_wavy',
    'light_ponytail',
    'light_spiky',
    'medium_curly',
    'medium_braids',
    'medium_fade',
    'medium_wavy',
    'medium_bun',
    'medium_short',
    'medDark_afro',
];

// Default background color (yellow, matches the avatar images)
const BG_COLOR = '#F5D558';

function getRandomAvatar() {
    const id = AVATAR_IDS[Math.floor(Math.random() * AVATAR_IDS.length)];
    return `avatar-creator://${id}?bg=${encodeURIComponent(BG_COLOR)}`;
}

async function assignAvatars() {
    const client = await pool.connect();

    try {
        // Get all users
        const result = await client.query('SELECT id, username, avatar FROM users');
        const users = result.rows;

        console.log(`\n🎨 Assigning random 3D avatars to ${users.length} users...\n`);

        let updated = 0;
        for (const user of users) {
            const avatarUrl = getRandomAvatar();
            await client.query(
                'UPDATE users SET avatar = $1 WHERE id = $2',
                [avatarUrl, user.id]
            );
            updated++;

            if (updated % 20 === 0) {
                console.log(`  Updated ${updated}/${users.length}...`);
            }
        }

        console.log(`\n✅ Done! Assigned random avatars to ${updated} users.`);
        console.log(`   Using ${AVATAR_IDS.length} unique avatar styles.\n`);

    } catch (e) {
        console.error('❌ Error:', e.message);
    } finally {
        client.release();
        await pool.end();
    }
}

assignAvatars();
