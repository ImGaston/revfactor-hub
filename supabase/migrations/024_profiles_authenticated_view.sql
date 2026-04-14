-- Allow all authenticated users to view basic profile info of all team members.
-- Required for team assignment dropdowns (task owner, pipeline team, roadmap owner, etc.)
-- which fail silently for non-super_admin users otherwise: the existing policies in
-- 001_profiles.sql restrict SELECT to the user's own profile unless they are super_admin,
-- so dropdowns that query the profiles table return only the caller's own row.
--
-- Postgres combines multiple PERMISSIVE RLS policies with OR, so adding this policy
-- expands access without dropping the existing ones. UPDATE/INSERT remain restricted
-- to super_admin via the policies in 001_profiles.sql.
CREATE POLICY "Authenticated users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);
