IF COL_LENGTH('dbo.Groups', 'currency') IS NULL
BEGIN
  ALTER TABLE dbo.Groups ADD currency varchar(8) NOT NULL
    CONSTRAINT DF_Groups_Currency DEFAULT 'money' WITH VALUES;
END;

IF COL_LENGTH('dbo.Groups', 'avatar') IS NULL
BEGIN
  ALTER TABLE dbo.Groups ADD avatar varchar(16) NOT NULL
    CONSTRAINT DF_Groups_Avatar DEFAULT 'paddles' WITH VALUES;
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Groups_Currency')
BEGIN
  EXEC(N'ALTER TABLE dbo.Groups WITH CHECK ADD CONSTRAINT CK_Groups_Currency CHECK (
    currency COLLATE Latin1_General_100_BIN2 IN (''none'', ''money'', ''boba'')
    AND DATALENGTH(currency) = LEN(currency)
  );');
END;

IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_Groups_Avatar')
BEGIN
  EXEC(N'ALTER TABLE dbo.Groups WITH CHECK ADD CONSTRAINT CK_Groups_Avatar CHECK (
    avatar COLLATE Latin1_General_100_BIN2 IN (
      ''paddles'', ''trophy'', ''medal'', ''stadium'', ''mountain'', ''island'',
      ''sunrise'', ''city'', ''castle'', ''camp'', ''planet'', ''rainbow''
    ) AND DATALENGTH(avatar) = LEN(avatar)
  );');
END;
