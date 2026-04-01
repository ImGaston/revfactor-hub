-- Change tasks.owner from TEXT to UUID referencing profiles
ALTER TABLE tasks
  ALTER COLUMN owner TYPE UUID USING owner::uuid;

ALTER TABLE tasks
  ADD CONSTRAINT tasks_owner_fk FOREIGN KEY (owner) REFERENCES profiles(id) ON DELETE SET NULL;
