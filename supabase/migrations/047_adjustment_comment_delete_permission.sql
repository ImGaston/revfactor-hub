-- Migration 047: allow adjustments:delete holders to delete any adjustment
-- comment (authors keep delete on their own). Until now the DELETE policy was
-- author-only, so super_admin couldn't discard test notes written by others.
-- Permission-based per conventions: super_admin passes has_permission()
-- implicitly, admin has adjustments:delete seeded; contractor/hostpricing
-- stay author-only.

DROP POLICY "Authors can delete own adjustment_comments" ON adjustment_comments;
CREATE POLICY "Authors and authorized users can delete adjustment_comments"
  ON adjustment_comments FOR DELETE TO authenticated
  USING (author_id = auth.uid() OR public.has_permission('adjustments', 'delete'));
