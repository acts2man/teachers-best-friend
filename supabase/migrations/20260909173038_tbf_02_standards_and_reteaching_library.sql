-- ---------------------------------------------------------------
-- STANDARDS
-- Global rows (teacher_id IS NULL) are the official CA standard set,
-- loaded once. Rows with a teacher_id are that teacher's custom
-- standards. Alignment is a vector lookup here, never a model recall.
-- ---------------------------------------------------------------
create table if not exists public.standards (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid references auth.users(id) on delete cascade,
  jurisdiction  text        not null default 'CA',
  framework     text        not null,
  subject       text        not null,
  grade         text        not null,
  code          text        not null,
  short_label   text,
  description   text        not null,
  domain        text,
  cluster       text,
  parent_code   text,
  embedding     extensions.vector(1536),
  active        boolean     not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.standards is
  'California (and later other states) content standards. Global rows have
   teacher_id IS NULL. Match worksheets against this table by embedding
   similarity — do NOT ask a model to recall a standard code.';

-- One canonical row per official standard code
create unique index if not exists standards_global_code_key
  on public.standards (jurisdiction, framework, code)
  where teacher_id is null;

create index if not exists standards_teacher_idx on public.standards (teacher_id) where teacher_id is not null;
create index if not exists standards_lookup_idx  on public.standards (jurisdiction, subject, grade) where active;
create index if not exists standards_embedding_idx
  on public.standards using hnsw (embedding extensions.vector_cosine_ops);

create trigger standards_touch before update on public.standards
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------
-- RETEACHING LIBRARY  ***GLOBAL / CROSS-TENANT***
-- The single biggest margin lever in the product. Reteaching material
-- for a given (standard x error pattern) is generated ONCE and served
-- to every teacher thereafter at zero marginal AI cost.
-- Never scope this table per-teacher.
-- ---------------------------------------------------------------
create table if not exists public.reteaching_library (
  id                   uuid primary key default gen_random_uuid(),
  standard_id          uuid        not null references public.standards(id) on delete cascade,
  error_pattern_key    text        not null,
  error_pattern_label  text        not null,
  grade_band           text        not null default '',
  title                text        not null,
  content              jsonb       not null,
  model                text,
  generation_cost_usd  numeric(10,6) not null default 0,
  times_served         integer     not null default 0,
  quality_score        numeric(3,2),
  review_status        text        not null default 'auto'
                         check (review_status in ('auto','approved','flagged','retired')),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on column public.reteaching_library.error_pattern_key is
  'Normalized slug for the misconception, e.g. added_denominators.
   (standard_id, error_pattern_key, grade_band) is the cache key.';

create unique index if not exists reteaching_cache_key
  on public.reteaching_library (standard_id, error_pattern_key, grade_band);

create index if not exists reteaching_standard_idx on public.reteaching_library (standard_id)
  where review_status <> 'retired';

create trigger reteaching_touch before update on public.reteaching_library
  for each row execute function public.touch_updated_at();

-- Cache-hit counter
create or replace function public.record_reteaching_hit(p_reteaching_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.reteaching_library
     set times_served = times_served + 1
   where id = p_reteaching_id;
$$;
