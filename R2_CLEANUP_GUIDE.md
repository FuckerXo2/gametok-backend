# R2 Asset Cleanup Guide

## Overview

You have old/useless assets in your Cloudflare R2 bucket that are causing issues. This guide shows you two ways to clean them up.

## What You Have

The R2 bucket contains old assets that were uploaded before you switched to the new **local asset catalog system** (2,651 assets in `/public/assets/`).

**Old System Issues:**
- Assets were uploaded to R2 with guessed/random names
- AI had to blind-guess filenames → 404 errors → broken games
- Wasting R2 storage and bandwidth

**New System:**
- Assets are scanned locally from `/public/assets/`
- Catalog is built with metadata (2,651 assets)
- AI sees actual available assets → uses real filenames → games work!

## Option 1: Automated Script (Recommended)

I created `clean-r2-assets.js` that can bulk delete assets from R2.

### Step 1: Get Railway Environment Variables

Since your R2 credentials are in Railway, you need to either:

**A. Download them locally:**
```bash
# In Railway dashboard, go to your backend service
# Settings → Variables → Download as .env
# Or manually copy these to your local .env file:
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-access-key-id
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=gametok-assets
```

**B. Run the script on Railway:**
```bash
# SSH into your Railway deployment and run it there
railway run node clean-r2-assets.js
```

### Step 2: Preview What Will Be Deleted

```bash
# See what's in your bucket (no deletion)
node clean-r2-assets.js

# This shows you:
# - Total files and size
# - Breakdown by folder (audio/, sprites/, etc.)
# - Sample filenames
```

### Step 3: Delete Old Assets

```bash
# Dry run - see what would be deleted without actually deleting
node clean-r2-assets.js --prefix=audio/ --dry-run

# Actually delete the audio folder
node clean-r2-assets.js --prefix=audio/ --confirm

# Delete sprites folder
node clean-r2-assets.js --prefix=sprites/ --confirm

# Delete backgrounds folder
node clean-r2-assets.js --prefix=backgrounds/ --confirm
```

### What NOT to Delete

Keep these folders (they're used by other systems):
- `covers/` - AI-generated game thumbnails (new system)
- `opengame-games/` - OpenGame generated game files

## Option 2: Manual Deletion (Cloudflare Dashboard)

If you prefer manual control:

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **R2 Object Storage**
3. Select your bucket: `gametok-assets`
4. Browse folders and select files to delete
5. Click **Delete** button

**Pros:**
- Visual interface
- See exactly what you're deleting
- More control

**Cons:**
- Slow for large amounts of files
- Tedious clicking
- Limited to 100 files at a time

## Option 3: Wrangler CLI

Use Cloudflare's official CLI tool:

```bash
# Install wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login

# List files in bucket
wrangler r2 object list gametok-assets

# Delete specific folder
wrangler r2 object delete gametok-assets --prefix audio/
```

## Recommended Approach

**Step-by-step:**

1. **First**, run the preview script to see what's there:
   ```bash
   node clean-r2-assets.js
   ```

2. **Identify** which folders are old/useless (likely `audio/`, `sprites/`, `backgrounds/`, `tiles/`)

3. **Test** on one small folder first:
   ```bash
   node clean-r2-assets.js --prefix=audio/ --dry-run
   node clean-r2-assets.js --prefix=audio/ --confirm
   ```

4. **Delete** the rest folder by folder:
   ```bash
   node clean-r2-assets.js --prefix=sprites/ --confirm
   node clean-r2-assets.js --prefix=backgrounds/ --confirm
   ```

## After Cleanup

Once old assets are deleted:

1. **Verify** games still work (they should use localhost:3000/assets/ now)
2. **Monitor** R2 storage usage in Cloudflare dashboard
3. **Optional**: Upload the new catalog to R2 for global CDN:
   ```bash
   # Upload the new local assets to R2 (for production)
   node upload-to-r2.js
   ```

## Safety Notes

⚠️ **The deletion is permanent!** R2 doesn't have a trash/recycle bin.

✅ **Good news:** Your new system doesn't rely on R2 assets anymore - they're all local in `/public/assets/`.

✅ **Backup option:** If you want to be extra safe, download the R2 bucket first:
```bash
# Using rclone or aws cli with R2 endpoint
aws s3 sync s3://gametok-assets ./r2-backup --endpoint-url https://[account-id].r2.cloudflarestorage.com
```

## Questions?

- **"Will this break my games?"** - No! Your new catalog system uses local assets, not R2.
- **"Should I delete everything?"** - No! Keep `covers/` and `opengame-games/`.
- **"Can I undo a deletion?"** - No, R2 deletions are permanent. Dry-run first!
- **"How much will I save?"** - Run the script to see total storage usage per folder.

---

## Complete Migration Workflow

Here's the full process to migrate from old to new assets:

### Step 1: Clean Up Old Assets

```bash
# Preview what's in R2
node clean-r2-assets.js

# Delete old asset folders (one by one for safety)
node clean-r2-assets.js --prefix=audio/ --confirm
node clean-r2-assets.js --prefix=sprites/ --confirm
node clean-r2-assets.js --prefix=backgrounds/ --confirm
```

### Step 2: Upload New Professional Assets

```bash
# Preview the upload (dry run)
node upload-catalog-to-r2.js --dry-run

# Upload all 2,651 professional assets
node upload-catalog-to-r2.js

# Upload specific folder only (optional)
node upload-catalog-to-r2.js --prefix=sprites/

# Skip files that already exist (resume interrupted upload)
node upload-catalog-to-r2.js --skip-existing
```

**Upload Features:**
- ✅ Uploads all 2,651 cataloged assets
- ✅ Preserves directory structure
- ✅ Sets proper MIME types and cache headers
- ✅ Parallel uploads (20 files at once) - super fast!
- ✅ Progress tracking and speed metrics
- ✅ Automatic retry on failures
- ✅ Uploads catalog.json metadata

### Step 3: Update Your Code

After upload, update the asset URL in your game generation:

```javascript
// In maker-claude-style-prompt.js
const BASE_URL = process.env.ASSETS_CDN_URL || 
  `https://pub-${process.env.R2_ACCOUNT_ID}.r2.dev/assets/`;
```

Set this in Railway:
```bash
ASSETS_CDN_URL=https://pub-YOUR-ACCOUNT-ID.r2.dev/assets/
```

### Step 4: Verify

Generate a test game and verify assets load from R2:
```bash
node test-game-generation.js "zombie shooter game"
# Check the generated game loads assets from R2 CDN
```

---

**Created:** 2026-07-06  
**Scripts:**
- `/gametok-backend/clean-r2-assets.js` - Bulk delete old assets
- `/gametok-backend/upload-catalog-to-r2.js` - Upload new professional assets
**New Asset Catalog:** `/gametok-backend/public/assets/` (2,651 files)
