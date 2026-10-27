IF COL_LENGTH('dbo.Players', 'is_deleted') IS NULL
  ALTER TABLE dbo.Players ADD is_deleted bit NOT NULL
    CONSTRAINT DF_PlayerIsDeleted DEFAULT 0 WITH VALUES;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_AnonymousPlayer')
  EXEC(N'ALTER TABLE dbo.Players ADD CONSTRAINT CK_AnonymousPlayer CHECK (
    is_deleted = 0 OR (is_guest = 0 AND display_name = N''Deleted player'' AND avatar = ''smile''));');

IF OBJECT_ID('dbo.GroupLifecycleMutations', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GroupLifecycleMutations (
    actor_id uniqueidentifier NOT NULL REFERENCES dbo.Players(id),
    request_id uniqueidentifier NOT NULL,
    fingerprint char(64) NOT NULL,
    group_id uniqueidentifier NOT NULL,
    action varchar(8) NOT NULL CHECK (action IN ('transfer', 'delete', 'retired')),
    PRIMARY KEY (actor_id, request_id)
  );
END;

IF OBJECT_ID('dbo.AccountDeletions', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.AccountDeletions (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    account_hash binary(32) NOT NULL UNIQUE,
    account_id uniqueidentifier NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    completed_at datetime2 NULL,
    last_attempt_at datetime2 NULL,
    retrying bit NOT NULL DEFAULT 0,
    CONSTRAINT CK_DeletionState CHECK (
      (account_id IS NOT NULL AND completed_at IS NULL) OR
      (account_id IS NULL AND completed_at IS NOT NULL AND retrying = 0))
  );
  CREATE INDEX IX_Deletions_Pending ON dbo.AccountDeletions(created_at)
    INCLUDE (account_id) WHERE completed_at IS NULL;
END;
