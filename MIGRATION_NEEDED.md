# Database Migration Required

## Issue
OAuth users are being auto-assigned usernames, but they should choose their own username during onboarding.

## Changes Made
1. Backend now creates OAuth users with `username = NULL`
2. Frontend checks if user has no username and forces onboarding
3. Username screen updates the user's username via API

## Migration Required
Run this SQL on your database:

```sql
ALTER TABLE users 
ALTER COLUMN username DROP NOT NULL;
```

This allows OAuth users to be created without a username initially.

## How to Run
If your database is on Render/Railway/etc:
1. Go to your database dashboard
2. Open the SQL console
3. Run the ALTER TABLE command above

Or run the migration script:
```bash
cd gametok-backend
node migrate-username-nullable.js
```

## After Migration
1. Restart your backend server
2. Test OAuth sign-in with a new Google/Apple account
3. Verify it goes through username selection
