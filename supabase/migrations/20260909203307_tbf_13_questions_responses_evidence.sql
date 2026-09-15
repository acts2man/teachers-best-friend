-- scan_items assumed one scan = one worksheet with its own items.
-- The real model is better: questions belong to the ASSESSMENT (extracted
-- once, shared by every student) and responses hang off those questions.
-- That means the question text is never re-read per student.
drop table if exists public.scan_items;

alter table public.assessments add column if not exists passage text;
alter table public.assessments add column if not exists status text default 'draft';
alter table public.assessments add column if not exists source text;
alter table public.assessments add column if not exists answer_key_verified boolean not null default false;
alter table public.assessments add column if not exists framework text;
alter table public.assessments add column if not exists legacy_id text;

-- ---------------------------------------------------------------
-- ASSESSMENT QUESTIONS  (extracted once per assessment)
-- ---------------------------------------------------------------
create table if not exists public.assessment_questions (
  id                      uuid primary key default gen_random_uuid(),
  assessment_id           uuid        not null references public.assessments(id) on delete cascade,
  teacher_id              uuid        not null references auth.users(id) on delete cascade,
  legacy_id               text,
  number                  integer,
  text                    text,
  passage                 text,
  answer                  text,
  standard_id             uuid        references public.standards(id) on delete set null,
  standard_code           text,
  secondary_standard_code text,
  skill                   text,
  dok                     integer,
  costas                  integer,
  alignment               numeric(5,2),
  improvement             text,
  confidence              numeric(4,3),
  level                   text,
  reasoning               text,
  verified                boolean     not null default false,
  excluded                boolean     not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index if not exists questions_assessment_idx on public.assessment_questions (assessment_id);
create index if not exists questions_teacher_idx    on public.assessment_questions (teacher_id);
create index if not exists questions_standard_idx   on public.assessment_questions (standard_id);
create unique index if not exists questions_legacy_key
  on public.assessment_questions (assessment_id, legacy_id) where legacy_id is not null;

-- ---------------------------------------------------------------
-- STUDENT RESPONSES  (one row per student per question)
-- ---------------------------------------------------------------
create table if not exists public.student_responses (
  id                 uuid primary key default gen_random_uuid(),
  teacher_id         uuid        not null references auth.users(id) on delete cascade,
  assessment_id      uuid        not null references public.assessments(id)        on delete cascade,
  question_id        uuid        not null references public.assessment_questions(id) on delete cascade,
  student_id         uuid        not null references public.students(id)           on delete cascade,
  scan_id            uuid        references public.scans(id) on delete set null,
  legacy_id          text,
  answer             text,
  correct            boolean,
  match_score        numeric(5,2),
  misconception_key  text,
  misconception_text text,
  reteaching_id      uuid        references public.reteaching_library(id) on delete set null,
  served_from_cache  boolean     not null default false,
  confidence         numeric(4,3),
  verified           boolean     not null default false,
  created_at         timestamptz not null default now()
);

comment on column public.student_responses.misconception_key is
  'Normalized snake_case slug, e.g. added_denominators. This is the cache
   key into reteaching_library. misconception_text is legacy free-text and
   should be phased out — it is expensive output and it is narrative about
   an identifiable child.';

create index if not exists responses_assessment_idx on public.student_responses (assessment_id);
create index if not exists responses_student_idx    on public.student_responses (student_id);
create index if not exists responses_question_idx   on public.student_responses (question_id);
create index if not exists responses_teacher_idx    on public.student_responses (teacher_id);
create index if not exists responses_wrong_idx      on public.student_responses (misconception_key)
  where correct = false;
create unique index if not exists responses_unique_key
  on public.student_responses (question_id, student_id);

-- ---------------------------------------------------------------
-- STUDENT EVIDENCE  (mastery over time, per standard)
-- ---------------------------------------------------------------
create table if not exists public.student_evidence (
  id            uuid primary key default gen_random_uuid(),
  teacher_id    uuid        not null references auth.users(id) on delete cascade,
  student_id    uuid        not null references public.students(id) on delete cascade,
  standard_id   uuid        references public.standards(id) on delete set null,
  standard_code text,
  assessment_id uuid        references public.assessments(id) on delete set null,
  score         numeric(5,2),
  source        text,
  recorded_on   date        not null default current_date,
  legacy_id     text,
  created_at    timestamptz not null default now()
);

create index if not exists evidence_student_idx  on public.student_evidence (student_id, recorded_on desc);
create index if not exists evidence_teacher_idx  on public.student_evidence (teacher_id);
create index if not exists evidence_standard_idx on public.student_evidence (standard_code);

-- ---------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------
alter table public.assessment_questions enable row level security;
alter table public.student_responses    enable row level security;
alter table public.student_evidence     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['assessment_questions','student_responses','student_evidence']
  loop
    execute format($f$
      create policy %1$s_own_select on public.%1$s
        for select to authenticated using (teacher_id = (select auth.uid()));
      create policy %1$s_own_insert on public.%1$s
        for insert to authenticated with check (teacher_id = (select auth.uid()));
      create policy %1$s_own_update on public.%1$s
        for update to authenticated
        using (teacher_id = (select auth.uid())) with check (teacher_id = (select auth.uid()));
      create policy %1$s_own_delete on public.%1$s
        for delete to authenticated using (teacher_id = (select auth.uid()));
    $f$, t);
  end loop;
end $$;

create trigger questions_touch before update on public.assessment_questions
  for each row execute function public.touch_updated_at();
