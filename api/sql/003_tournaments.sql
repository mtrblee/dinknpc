IF OBJECT_ID('dbo.Tournaments', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.Tournaments (
    group_id uniqueidentifier NOT NULL REFERENCES dbo.Groups(id),
    id uniqueidentifier NOT NULL,
    state_json nvarchar(max) NOT NULL,
    created_at datetime2 NOT NULL DEFAULT SYSUTCDATETIME(),
    PRIMARY KEY (group_id, id),
    CONSTRAINT CK_TournamentJson CHECK (ISJSON(state_json) = 1)
  );
END;

IF COL_LENGTH('dbo.Games', 'tournament_id') IS NULL
  ALTER TABLE dbo.Games ADD tournament_id uniqueidentifier NULL,
    tournament_match_id nvarchar(80) NULL, tournament_stage varchar(12) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_GameTournament')
  EXEC(N'ALTER TABLE dbo.Games ADD CONSTRAINT FK_GameTournament
    FOREIGN KEY (group_id, tournament_id) REFERENCES dbo.Tournaments(group_id, id);');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_GameTournamentTag')
  EXEC(N'ALTER TABLE dbo.Games ADD CONSTRAINT CK_GameTournamentTag CHECK (
    (tournament_id IS NULL AND tournament_match_id IS NULL AND tournament_stage IS NULL)
    OR (tournament_id IS NOT NULL AND tournament_match_id IS NOT NULL
      AND tournament_stage IS NOT NULL AND tournament_stage IN (''pool'', ''playoff'', ''championship'') AND wager_cents = 0));');
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TournamentScore')
  EXEC(N'ALTER TABLE dbo.Games ADD CONSTRAINT CK_TournamentScore CHECK (
    tournament_id IS NULL OR status = ''pending'' OR
    ((CASE WHEN score_a > score_b THEN score_a ELSE score_b END) = (CASE WHEN tournament_stage = ''pool'' THEN 11 ELSE 15 END)
      AND ABS(score_a - score_b) >= 2) OR
    ((CASE WHEN score_a > score_b THEN score_a ELSE score_b END) > (CASE WHEN tournament_stage = ''pool'' THEN 11 ELSE 15 END)
      AND ABS(score_a - score_b) = 2));');
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UQ_TournamentGame' AND object_id = OBJECT_ID('dbo.Games'))
  EXEC(N'CREATE UNIQUE INDEX UQ_TournamentGame ON dbo.Games(group_id, tournament_id, tournament_match_id)
    WHERE tournament_id IS NOT NULL;');

IF COL_LENGTH('dbo.Mutations', 'tournament_id') IS NULL
  ALTER TABLE dbo.Mutations ADD tournament_id uniqueidentifier NULL;
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_MutationTournament')
  EXEC(N'ALTER TABLE dbo.Mutations ADD CONSTRAINT FK_MutationTournament
    FOREIGN KEY (group_id, tournament_id) REFERENCES dbo.Tournaments(group_id, id);');
