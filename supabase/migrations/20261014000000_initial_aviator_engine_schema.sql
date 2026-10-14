create extension if not exists pgcrypto;

create table if not exists public.game_rounds (
  id bigint generated always as identity primary key,
  provider text not null,
  game_code text not null default 'aviator',
  external_round_id text not null,
  round_ended_at timestamptz,
  crash_multiplier numeric(12,4) not null check (crash_multiplier >= 1),
  source text not null,
  source_verified boolean not null default false,
  round_hash text,
  server_hash text,
  raw_payload jsonb not null default '{}'::jsonb,
  collected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(provider, game_code, external_round_id)
);
create index if not exists game_rounds_time_idx on public.game_rounds (round_ended_at desc);
create index if not exists game_rounds_provider_idx on public.game_rounds (provider, game_code);

create table if not exists public.model_predictions (
  id bigint generated always as identity primary key,
  model_version text not null,
  target_multiplier numeric(12,4) not null check (target_multiplier >= 1),
  predicted_probability numeric(8,7) not null check (predicted_probability between 0 and 1),
  estimated_probability numeric(8,7) check (estimated_probability between 0 and 1),
  sample_size integer not null default 0 check (sample_size >= 0),
  data_cutoff timestamptz not null,
  created_at timestamptz not null default now(),
  evaluated_round_id text,
  outcome_reached boolean,
  brier_score numeric(12,8),
  status text not null default 'pending' check (status in ('pending','evaluated','excluded'))
);
create index if not exists model_predictions_created_idx on public.model_predictions (created_at desc);

create table if not exists public.engine_alerts (
  id bigint generated always as identity primary key,
  alert_type text not null,
  severity text not null check (severity in ('info','warning','critical')),
  message text not null,
  model_version text,
  round_id text,
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz
);
create index if not exists engine_alerts_created_idx on public.engine_alerts (created_at desc);

create table if not exists public.ingestion_runs (
  id bigint generated always as identity primary key,
  source text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  rounds_received integer not null default 0 check (rounds_received >= 0),
  rounds_inserted integer not null default 0 check (rounds_inserted >= 0),
  status text not null check (status in ('running','success','partial','failed')),
  error_message text
);

alter table public.game_rounds enable row level security;
alter table public.model_predictions enable row level security;
alter table public.engine_alerts enable row level security;
alter table public.ingestion_runs enable row level security;

revoke all on public.game_rounds from anon, authenticated;
revoke all on public.model_predictions from anon, authenticated;
revoke all on public.engine_alerts from anon, authenticated;
revoke all on public.ingestion_runs from anon, authenticated;

grant all on public.game_rounds to service_role;
grant all on public.model_predictions to service_role;
grant all on public.engine_alerts to service_role;
grant all on public.ingestion_runs to service_role;