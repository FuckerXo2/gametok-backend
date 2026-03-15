import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

const thumbnails = {
  'openpigeon_chess': 'https://games.gametok.co/openpigeon-games/thumbnails/chess.png',
  'openpigeon_checkers': 'https://games.gametok.co/openpigeon-games/thumbnails/checkers.png',
  'openpigeon_connect4': 'https://games.gametok.co/openpigeon-games/thumbnails/connect.png',
  'openpigeon_basketball': 'https://games.gametok.co/openpigeon-games/thumbnails/basketball.png',
  'openpigeon_seabattle': 'https://games.gametok.co/openpigeon-games/thumbnails/sea.png',
  'openpigeon_darts': 'https://games.gametok.co/openpigeon-games/thumbnails/darts.png',
  'openpigeon_cuppong': 'https://games.gametok.co/openpigeon-games/thumbnails/beer.png',
  'openpigeon_archery': 'https://games.gametok.co/openpigeon-games/thumbnails/archery.jpg',
  'openpigeon_mancala': 'https://games.gametok.co/openpigeon-games/thumbnails/mancala.png',
  'openpigeon_reversi': 'https://games.gametok.co/openpigeon-games/thumbnails/reversi.png',
  'openpigeon_gomoku': 'https://games.gametok.co/openpigeon-games/thumbnails/gomoku.png',
  'openpigeon_dots': 'https://games.gametok.co/openpigeon-games/thumbnails/dots.png',
  'openpigeon_filler': 'https://games.gametok.co/openpigeon-games/thumbnails/fill.png',
  'openpigeon_anagrams': 'https://games.gametok.co/openpigeon-games/thumbnails/anagrams.png',
  'openpigeon_wordbites': 'https://games.gametok.co/openpigeon-games/thumbnails/bites.png',
  'openpigeon_questions': 'https://games.gametok.co/openpigeon-games/thumbnails/questions.png',
};

async function update() {
  const client = await pool.connect();
  try {
    for (const [id, thumb] of Object.entries(thumbnails)) {
      await client.query('UPDATE games SET thumbnail = $1 WHERE id = $2', [thumb, id]);
      console.log('Updated ' + id);
    }
    console.log('Done!');
  } finally {
    client.release();
    await pool.end();
  }
}
update();
