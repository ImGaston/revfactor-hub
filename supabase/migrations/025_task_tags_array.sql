-- Convert tasks.tag (TEXT, single value) into tasks.tags (TEXT[]) so a task
-- can have multiple tags. The old single tag is migrated into the array.

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE tasks
SET tags = ARRAY[tag]
WHERE tag IS NOT NULL
  AND tag <> ''
  AND (tags IS NULL OR array_length(tags, 1) IS NULL);

ALTER TABLE tasks DROP COLUMN IF EXISTS tag;
