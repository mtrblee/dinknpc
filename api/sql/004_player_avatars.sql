IF COL_LENGTH('dbo.Players', 'avatar') IS NULL
BEGIN
  ALTER TABLE dbo.Players ADD avatar varchar(16) NOT NULL
    CONSTRAINT DF_Players_Avatar DEFAULT 'smile' WITH VALUES;
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Players_Avatar')
BEGIN
  EXEC(N'ALTER TABLE dbo.Players WITH CHECK ADD CONSTRAINT CK_Players_Avatar CHECK (
    avatar COLLATE Latin1_General_100_BIN2 IN (
      ''smile'', ''cool'', ''star-eyes'', ''party'', ''fox'', ''panda'', ''frog'', ''tiger'',
      ''lion'', ''koala'', ''monkey'', ''dog'', ''cat'', ''penguin'', ''unicorn'', ''turtle'',
      ''octopus'', ''butterfly'', ''bee'', ''cactus'', ''clover'', ''pineapple'', ''rocket'', ''star''
    ) AND DATALENGTH(avatar) = LEN(avatar)
  );');
END;
