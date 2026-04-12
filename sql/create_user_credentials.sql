-- Create table to store per-user ElevenLabs credentials (no encryption)
-- Run this in Supabase SQL editor for your project.

create table if not exists public.user_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  eleven_api_key text,
  eleven_voice_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Enable Row Level Security and add a policy so users can only access their own row
alter table public.user_credentials enable row level security;

create policy user_owns_row on public.user_credentials
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Optional: create index on user_id
create index if not exists idx_user_credentials_user_id on public.user_credentials(user_id);
