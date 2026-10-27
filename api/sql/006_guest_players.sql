IF COL_LENGTH('dbo.Players', 'is_guest') IS NULL
  ALTER TABLE dbo.Players ADD is_guest bit NOT NULL
    CONSTRAINT DF_PlayerIsGuest DEFAULT 0 WITH VALUES;
