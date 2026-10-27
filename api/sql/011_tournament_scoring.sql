IF COL_LENGTH('dbo.Games', 'tournament_target') IS NULL
  ALTER TABLE dbo.Games ADD tournament_target tinyint NULL;
IF COL_LENGTH('dbo.Games', 'tournament_game_number') IS NULL
  ALTER TABLE dbo.Games ADD tournament_game_number tinyint NOT NULL
    CONSTRAINT DF_TournamentGameNumber DEFAULT 0 WITH VALUES;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TournamentFormat')
  EXEC(N'ALTER TABLE dbo.Games WITH CHECK ADD CONSTRAINT CK_TournamentFormat CHECK (
    (tournament_id IS NULL AND tournament_target IS NULL AND tournament_game_number = 0)
    OR (tournament_id IS NOT NULL AND (tournament_target IS NULL OR tournament_target IN (11, 15))
      AND (tournament_game_number = 0 OR
        (tournament_stage = ''championship'' AND tournament_target IS NOT NULL AND tournament_target = 11
          AND tournament_game_number BETWEEN 1 AND 3))));');

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_TournamentScore')
  ALTER TABLE dbo.Games DROP CONSTRAINT CK_TournamentScore;
EXEC(N'ALTER TABLE dbo.Games WITH CHECK ADD CONSTRAINT CK_TournamentScore CHECK (
  tournament_id IS NULL OR status = ''pending'' OR
  ((CASE WHEN score_a > score_b THEN score_a ELSE score_b END) =
    COALESCE(tournament_target, CASE WHEN tournament_stage = ''pool'' THEN 11 ELSE 15 END)
    AND ABS(score_a - score_b) >= 2) OR
  ((CASE WHEN score_a > score_b THEN score_a ELSE score_b END) >
    COALESCE(tournament_target, CASE WHEN tournament_stage = ''pool'' THEN 11 ELSE 15 END)
    AND ABS(score_a - score_b) = 2));');

IF NOT EXISTS (
  SELECT 1 FROM sys.indexes i
  JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
  JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
  WHERE i.object_id = OBJECT_ID('dbo.Games') AND i.name = 'UQ_TournamentGame'
    AND c.name = 'tournament_game_number' AND ic.key_ordinal = 4
)
BEGIN
  IF EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.Games') AND name = 'UQ_TournamentGame')
    DROP INDEX UQ_TournamentGame ON dbo.Games;
  EXEC(N'CREATE UNIQUE INDEX UQ_TournamentGame
    ON dbo.Games(group_id, tournament_id, tournament_match_id, tournament_game_number)
    WHERE tournament_id IS NOT NULL;');
END;
