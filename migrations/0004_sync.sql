-- Sync. Conflicts are settled per field: the newest change to each field wins. So each row
-- remembers when every one of its fields was last set (field_times, as JSON), and two devices
-- that edit different fields of one record both keep their edits.
ALTER TABLE stores ADD COLUMN field_times TEXT NOT NULL DEFAULT '{}';
ALTER TABLE trips ADD COLUMN field_times TEXT NOT NULL DEFAULT '{}';
ALTER TABLE items ADD COLUMN field_times TEXT NOT NULL DEFAULT '{}';

-- What has changed, in the order the server accepted it. A device asks for everything after the
-- last seq it saw. The order is the server's, not the devices' clocks, so a change that arrives
-- late (from a phone that was offline) is still after every device's position. One row per
-- record: accepting a change moves the record's row to the end.
CREATE TABLE changes (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL
);

CREATE UNIQUE INDEX changes_record ON changes (table_name, record_id);
