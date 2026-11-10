-- Genie actions: changes Genie proposes (create a locum shift, cancel an appointment...)
-- are stored here as "pending" and only carried out when the staff member taps Confirm.
-- The ai-chat edge function writes this table with the service role and performs the
-- change with the user's own session, so row security and permissions still apply.

create table if not exists public.ps_genie_actions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.ps_organisations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.ps_chat_conversations(id) on delete cascade,
  message_id uuid references public.ps_chat_messages(id) on delete set null,
  tool text not null,
  args jsonb not null default '{}'::jsonb,
  summary text not null,
  details jsonb not null default '[]'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'done', 'cancelled', 'failed', 'expired')),
  result jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  decided_at timestamptz
);

create index if not exists ps_genie_actions_conversation_idx on public.ps_genie_actions (conversation_id, created_at);
create index if not exists ps_genie_actions_user_idx on public.ps_genie_actions (user_id, created_at desc);

alter table public.ps_genie_actions enable row level security;

drop policy if exists "genie_actions_select_own" on public.ps_genie_actions;
create policy "genie_actions_select_own" on public.ps_genie_actions
  for select to authenticated
  using (user_id = auth.uid());

grant select on public.ps_genie_actions to authenticated;
grant all on public.ps_genie_actions to service_role;
