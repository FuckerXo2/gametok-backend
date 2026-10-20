# GTA Lagos multiplayer server (lagos-online)

Deployed by `cloudbuild.yaml` with the backend: its own Cloud Run service in europe-west2 (closest
to Lagos), one always-on instance (players' money lives in it), files on the bucket
`$PROJECT_ID-lagos-online-data` mounted at `/data`.

The source of truth is the game repo (`gameidea/games/gta-lagos/server`); copy it here with
`games/gta-lagos/tools/sync_server.sh` before pushing.

Not set yet (add when ready): `GAMETOK_API_KEY` (checks players are signed in to GameTok; until
then each device is its own player) and `ADMIN_KEY` (opens /reports, /ban, /flags, /ads).
