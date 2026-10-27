IF OBJECT_ID('dbo.Players', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Players (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    display_name nvarchar(max) NOT NULL,
    CONSTRAINT CK_PlayerName CHECK (LEN(LTRIM(RTRIM(display_name))) > 0)
  );
  CREATE TABLE dbo.Groups (
    id uniqueidentifier NOT NULL PRIMARY KEY,
    owner_id uniqueidentifier NOT NULL REFERENCES dbo.Players(id),
    name nvarchar(max) NOT NULL,
    next_game_number bigint NOT NULL DEFAULT 1,
    revision rowversion NOT NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT CK_GroupName CHECK (LEN(LTRIM(RTRIM(name))) > 0),
    CONSTRAINT CK_GameCounter CHECK (next_game_number BETWEEN 1 AND 9007199254740991)
  );
  CREATE INDEX IX_Groups_Owner ON dbo.Groups(owner_id);
  CREATE TABLE dbo.GroupMembers (
    group_id uniqueidentifier NOT NULL REFERENCES dbo.Groups(id),
    player_id uniqueidentifier NOT NULL REFERENCES dbo.Players(id),
    name_snapshot nvarchar(max) NOT NULL,
    position int NOT NULL,
    PRIMARY KEY (group_id, player_id),
    CONSTRAINT UQ_MemberPosition UNIQUE (group_id, position)
  );
  CREATE INDEX IX_Members_Player ON dbo.GroupMembers(player_id, group_id);
  CREATE TABLE dbo.Games (
    group_id uniqueidentifier NOT NULL REFERENCES dbo.Groups(id),
    id nvarchar(80) NOT NULL,
    game_number bigint NOT NULL,
    team_a1 uniqueidentifier NOT NULL,
    team_a2 uniqueidentifier NOT NULL,
    team_b1 uniqueidentifier NOT NULL,
    team_b2 uniqueidentifier NOT NULL,
    wager_cents bigint NOT NULL,
    status varchar(9) NOT NULL,
    score_a bigint NULL,
    score_b bigint NULL,
    PRIMARY KEY (group_id, id),
    CONSTRAINT UQ_GameNumber UNIQUE (group_id, game_number),
    FOREIGN KEY (group_id, team_a1) REFERENCES dbo.GroupMembers(group_id, player_id),
    FOREIGN KEY (group_id, team_a2) REFERENCES dbo.GroupMembers(group_id, player_id),
    FOREIGN KEY (group_id, team_b1) REFERENCES dbo.GroupMembers(group_id, player_id),
    FOREIGN KEY (group_id, team_b2) REFERENCES dbo.GroupMembers(group_id, player_id),
    CONSTRAINT CK_DistinctPlayers CHECK (
      team_a1 <> team_a2 AND team_a1 <> team_b1 AND team_a1 <> team_b2
      AND team_a2 <> team_b1 AND team_a2 <> team_b2 AND team_b1 <> team_b2),
    CONSTRAINT CK_Wager CHECK (wager_cents BETWEEN 0 AND 9007199254740991),
    CONSTRAINT CK_ScoreA CHECK (score_a IS NULL OR score_a BETWEEN 0 AND 9007199254740991),
    CONSTRAINT CK_ScoreB CHECK (score_b IS NULL OR score_b BETWEEN 0 AND 9007199254740991),
    CONSTRAINT CK_GameStatus CHECK (
      (status = 'pending' AND score_a IS NULL AND score_b IS NULL)
      OR (status = 'completed' AND score_a IS NOT NULL AND score_b IS NOT NULL AND score_a <> score_b))
  );
  CREATE TABLE dbo.Mutations (
    actor_id uniqueidentifier NOT NULL REFERENCES dbo.Players(id),
    request_id uniqueidentifier NOT NULL,
    fingerprint char(64) NOT NULL,
    group_id uniqueidentifier NOT NULL REFERENCES dbo.Groups(id),
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (actor_id, request_id)
  );
END;
