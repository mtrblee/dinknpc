IF COL_LENGTH('dbo.Groups', 'is_public') IS NULL
  ALTER TABLE dbo.Groups ADD is_public bit NOT NULL CONSTRAINT DF_Groups_Private DEFAULT 0 WITH VALUES;

IF OBJECT_ID('dbo.GroupJoinRequests', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.GroupJoinRequests (
    group_id uniqueidentifier NOT NULL REFERENCES dbo.Groups(id),
    player_id uniqueidentifier NOT NULL REFERENCES dbo.Players(id),
    status varchar(8) NOT NULL,
    requested_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (group_id, player_id),
    CONSTRAINT CK_JoinRequestStatus CHECK (status IN ('pending', 'declined'))
  );
  CREATE INDEX IX_JoinRequests_Pending ON dbo.GroupJoinRequests(group_id, status);
END;
