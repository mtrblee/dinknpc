IF OBJECT_ID('dbo.PlayerCodes', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.PlayerCodes (
    code varchar(6) COLLATE Latin1_General_100_BIN2 NOT NULL CONSTRAINT PK_PlayerCodes PRIMARY KEY,
    player_id uniqueidentifier NULL,
    CONSTRAINT FK_PlayerCodes_Player FOREIGN KEY (player_id) REFERENCES dbo.Players(id) ON DELETE SET NULL,
    CONSTRAINT CK_PlayerCodes_Format CHECK (
      DATALENGTH(code) = 6 AND code NOT LIKE '%[^ABCDEFGHJKLMNPQRSTUVWXYZ23456789]%')
  );
  CREATE UNIQUE INDEX UX_PlayerCodes_Player ON dbo.PlayerCodes(player_id) WHERE player_id IS NOT NULL;
END;

DECLARE @player uniqueidentifier, @code varchar(6), @bytes varbinary(6), @position int, @attempt int;
DECLARE @alphabet varchar(32) = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
DECLARE players_without_codes CURSOR LOCAL FAST_FORWARD FOR
  SELECT p.id FROM dbo.Players p WHERE p.is_guest = 0 AND p.is_deleted = 0
    AND NOT EXISTS (SELECT 1 FROM dbo.PlayerCodes c WHERE c.player_id = p.id);
OPEN players_without_codes;
FETCH NEXT FROM players_without_codes INTO @player;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @attempt = 0;
  WHILE 1 = 1
  BEGIN
    SET @attempt += 1;
    IF @attempt > 128 THROW 50000, 'Unable to allocate a unique player code; migration rolled back.', 1;
    SET @bytes = CRYPT_GEN_RANDOM(6);
    SET @code = '';
    SET @position = 1;
    WHILE @position <= 6
    BEGIN
      SET @code += SUBSTRING(@alphabet, (CONVERT(int, SUBSTRING(@bytes, @position, 1)) & 31) + 1, 1);
      SET @position += 1;
    END;
    IF NOT EXISTS (SELECT 1 FROM dbo.PlayerCodes WITH (UPDLOCK, HOLDLOCK) WHERE code = @code) BREAK;
  END;
  INSERT dbo.PlayerCodes(code, player_id) VALUES (@code, @player);
  FETCH NEXT FROM players_without_codes INTO @player;
END;
CLOSE players_without_codes;
DEALLOCATE players_without_codes;
