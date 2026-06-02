# Lost Expeditions MVP

A private 2-player expedition card game inspired by Lost Cities. Built with Next.js, Supabase Realtime, guest rooms, and a module-ready rules engine.

## Run locally

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Supabase setup

1. Create a new Supabase project.
2. Open the SQL editor and run `supabase/schema.sql`.
3. Copy the project URL and anon key from Project Settings -> API.
4. Put them into `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
```

5. Restart `npm run dev`.

The schema enables:
- `games` table for room state
- Row level security for public guest access
- Realtime updates on `games`
- Auto-updated `updated_at` timestamps

## Flow

- `/` creates a guest room.
- `/room/[roomCode]` lets players join with a display name.
- Two guests can play in realtime.
- Game state is stored in `games.state` as JSONB.

## Notes

This is intentionally named and written as an original private expedition card game, not an official clone. Use your own artwork/names.

## Included prototype assets

The generated exploration-themed asset sheet is included in `public/assets/asset-sheet.png`.
Cropped card art is available in `public/assets/cards/` and used by `components/CardView.tsx`:

- Desert / yellow
- Jungle / green
- Mountain / white
- Volcano / red
- Ocean / blue
- Card back

UI crops are also available in `public/assets/ui/` for future polish.
