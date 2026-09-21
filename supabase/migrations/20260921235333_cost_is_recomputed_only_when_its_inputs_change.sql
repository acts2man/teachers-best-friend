-- An update to a scan row rewrote what it cost.
--
-- scans_compute_cost is a BEFORE UPDATE trigger, firing WHEN auth.uid() IS
-- NULL -- that is, on every service-role write, which is every write the
-- application makes from the server. It recomputes cost_usd from the model and
-- token columns and assigns the result unconditionally:
--
--   new.cost_usd := round(c, 6);
--
-- with c starting at 0 and staying there if the model is NULL or is not in
-- public.model_pricing. So any update to any other column on that row -- one
-- that has nothing to do with money -- silently re-derived the money, and
-- re-derived it as zero whenever the price was no longer on file.
--
-- That was harmless while nothing updated a finished scan. This change adds
-- two things that do:
--
--   purge_scan_payloads()      clears params, result and error at 48 hours
--   delete_teacher_account()   sets teacher_id to NULL so the cost log
--                              survives the account
--
-- and the ON DELETE SET NULL foreign key added alongside them is a third: an
-- auth user deleted by hand issues an UPDATE too. Each of those would have
-- re-derived the cost of work already paid for, at the exact moment the point
-- was to preserve it. Caught by supabase/checks/account-deletion.sql, which
-- asserts cost_usd is untouched across a deletion and found it zeroed.
--
-- Today every one of the 31 costed rows names a model that is still in
-- model_pricing, so the recomputation happens to reproduce the stored number
-- and nothing has been lost. That is luck, not design: it lasts exactly until
-- a retired model is removed from the price list, and then the cost of every
-- old scan that used it drops to zero the next time anything touches the row.
--
-- The cost is computed when the usage is recorded. It is not a view over the
-- token columns, to be recalculated whenever the row is looked at sideways.
-- The trigger now fires only when one of its own inputs actually changes,
-- which is precisely what record_scan_usage() does and nothing else does.

drop trigger if exists scans_compute_cost on public.scans;

create trigger scans_compute_cost
  before update on public.scans
  for each row
  when (
    auth.uid() is null
    and (
         old.extract_model              is distinct from new.extract_model
      or old.extract_input_tokens       is distinct from new.extract_input_tokens
      or old.extract_cached_input_tokens is distinct from new.extract_cached_input_tokens
      or old.extract_output_tokens      is distinct from new.extract_output_tokens
      or old.reteach_model              is distinct from new.reteach_model
      or old.reteach_input_tokens       is distinct from new.reteach_input_tokens
      or old.reteach_cached_input_tokens is distinct from new.reteach_cached_input_tokens
      or old.reteach_output_tokens      is distinct from new.reteach_output_tokens
    )
  )
  execute function public.compute_scan_cost();
