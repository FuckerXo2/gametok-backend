import pkg from 'pg';
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:CIsVGsNrmDRAsEDjNEfCFlWjiVAyLfjG@gondola.proxy.rlwy.net:53291/railway',
  ssl: { rejectUnauthorized: false }
});

const brokenDraftIds = [
  'dd4750ad-0244-4e15-b3e8-2866cb170ea2',
  '6a6b1166-9513-4a0c-a9c3-f18fef66f945',
  'b7293fcd-fa36-4418-99bd-2d23372c73da',
  '3e319459-ac4a-466c-8d94-59c5580c56ce',
  '9396e929-60b7-4050-86ad-eb169899ebb8',
  'b77e9a76-edb3-4b28-b073-feabf32e49d2',
  'dc83bc7f-3491-45ec-ac39-479daebe0652',
  'b11db940-6f33-4c10-91a8-dcae869f63d9',
  '8c81555d-5915-437f-9541-48ff3c7412c9',
  '59c4b562-edcd-4f00-94bd-3fa21e788b4a',
  '4f0526a6-b27f-4281-ba4c-0c0ee9f02515',
  '285483a6-4f34-4859-b7cd-97d7a662c40e',
  '651840e3-3158-4b06-95fd-524cd128c131',
  'd0b67d3a-a8ed-42ca-ad06-4cb06841f6b3',
  'a8240118-1a4c-4e85-aab9-76ed18368dda',
  '87976070-35b9-4668-a978-c81c98d1338c',
  '826383a3-294d-4661-95b8-2743b7c73b29',
  '6ca70f6d-e5b7-4898-9aca-76ab6b1e750c',
  '0cb4bd0c-a770-40d4-9dac-f7ef8f0a5ea9',
  'e1a47072-b192-49df-82c4-f0ced135ce78',
  '98fbf5c4-0afe-43ec-bb00-23dd6c74ebeb',
  '58b6d676-01d6-48a7-8f6c-3b457520237d',
  'c50b8c6b-028e-4348-bacd-77e2bde9b37e',
  '6c6de82e-17f4-4b7b-af62-bdc773c0e293',
  'ec1b0b09-e04f-47fe-9816-879568ff6e5d',
  '3b0005ab-42fb-470b-b901-204c1e8f38f3',
  'f2e2c747-76fa-4255-bd7c-cf56bd799807',
  '9600b3f2-ab25-4451-8703-52fbd38c461e',
  '211b0fa5-b3dd-4654-be2e-52d8227c0c4a',
  '7058365a-6c65-4125-a023-a900e88113e5',
  '8fc7ce61-1454-474d-af4b-5006c291807a',
  '4d47ee0d-7caf-42ca-85bd-36500b343cc2',
  '338d9ce7-81d1-465c-bcc2-4bc16f27d35c',
  '58ec801c-ddac-4921-aca0-dba8ac139d98',
  '0b8c6800-7a14-4080-9557-ec5f2ab64123',
  'cf9c5c66-3056-477c-9d9f-efb3f1151eae',
  '56c6b562-1dd8-47e1-82e8-222da794943d',
  'b72b5a7a-4418-41f2-86c6-75723cca37e5',
  '13beaaf8-ae96-4a15-8dbf-27483d78252e',
  '2ec34066-749b-40da-86ee-26fdf77f3def',
  '3483e6d0-078d-4a00-939c-45f3f20908aa',
  'eb644cdc-f05a-40cc-ab81-dde3030564d6',
  'fc3ffe64-2510-4167-86c1-4af1f12b7ea5',
  '5cc3cbdc-f0af-4a2e-92f5-4f602495433c'
];

async function deleteBrokenDrafts() {
  try {
    console.log(`\n🗑️  Deleting ${brokenDraftIds.length} broken drafts...\n`);
    
    const result = await pool.query(
      'DELETE FROM ai_games WHERE id = ANY($1) RETURNING id, title',
      [brokenDraftIds]
    );

    console.log(`✅ Successfully deleted ${result.rows.length} drafts:\n`);
    result.rows.forEach((draft, i) => {
      console.log(`${i + 1}. ${draft.title || 'Untitled'} (${draft.id})`);
    });

    // Check remaining drafts
    const remaining = await pool.query(
      'SELECT COUNT(*) FROM ai_games WHERE is_draft = true'
    );
    
    console.log(`\n📊 Remaining drafts: ${remaining.rows[0].count}`);

    await pool.end();
  } catch (error) {
    console.error('Error deleting drafts:', error.message);
    process.exit(1);
  }
}

deleteBrokenDrafts();
