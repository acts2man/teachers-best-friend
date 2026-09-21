-- Not a migration. Nothing in supabase/migrations/ should ever apply this file,
-- and it is safe to run as many times as you like: it only reads.
--
-- The JS test harness has no database, so it cannot cover a line of SQL. The
-- billing-period arithmetic is the part of this schema most worth covering --
-- it decides which scans count against a teacher's quota -- so it gets its own
-- assertion suite here instead of going untested.
--
-- How to run it: paste the whole file into the Supabase SQL editor on the
-- Teachers Best Friend project and execute. Every row must come back with
-- pass = true and contains_day = true. The ordering puts failures first, so a
-- false at the top of the result is the thing to read.

with cases(label, s, e, on_day, expect_start, expect_end) as (values
  ('still inside window',       '2026-09-01'::date,'2026-10-01'::date,'2026-09-20'::date,'2026-09-01'::date,'2026-10-01'::date),
  ('first day of expiry',       '2026-09-01','2026-10-01','2026-10-01','2026-10-01','2026-11-01'),
  ('mid next month',            '2026-09-01','2026-10-01','2026-10-17','2026-10-01','2026-11-01'),
  ('dormant 7 months',          '2026-09-01','2026-10-01','2027-04-09','2027-04-01','2027-05-01'),
  ('anniversary mid-month',     '2026-09-15','2026-10-15','2026-11-02','2026-10-15','2026-11-15'),
  ('anniversary same day',      '2026-09-15','2026-10-15','2026-10-15','2026-10-15','2026-11-15'),
  ('month-end 31st',            '2026-01-31','2026-02-28','2026-03-05','2026-02-28','2026-03-28'),
  ('annual plan still current', '2026-01-01','2027-01-01','2026-09-20','2026-01-01','2027-01-01'),
  ('annual plan lapsed',        '2025-01-01','2026-01-01','2026-09-20','2026-01-01','2027-01-01'),
  ('leap day start',            '2024-02-29','2024-03-29','2024-05-02','2024-04-29','2024-05-29'),
  ('day before expiry',         '2026-09-01','2026-10-01','2026-09-30','2026-09-01','2026-10-01')
)
select c.label, w.period_start, w.period_end,
       (w.period_start = c.expect_start and w.period_end = c.expect_end) as pass,
       (c.on_day >= w.period_start and c.on_day < w.period_end) as contains_day
from cases c cross join lateral public.period_window(c.s, c.e, c.on_day) w
-- `pass` here is this query's own output column, not a column of `cases` --
-- qualifying it as c.pass makes Postgres reject the whole file.
order by pass, c.label;
