IF COL_LENGTH('dbo.Games', 'created_at') IS NULL
  ALTER TABLE dbo.Games ADD created_at datetime2 NULL
    CONSTRAINT DF_GameCreatedAt DEFAULT SYSUTCDATETIME();

IF COL_LENGTH('dbo.Games', 'completed_at') IS NULL
  ALTER TABLE dbo.Games ADD completed_at datetime2 NULL;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GameTimestamps')
  EXEC(N'ALTER TABLE dbo.Games ADD CONSTRAINT CK_GameTimestamps CHECK (
    (status <> ''pending'' OR completed_at IS NULL)
    AND (created_at IS NULL OR completed_at IS NULL OR completed_at >= created_at));');
