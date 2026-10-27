IF COL_LENGTH('dbo.GroupMembers', 'is_admin') IS NULL
  ALTER TABLE dbo.GroupMembers ADD is_admin bit NOT NULL
    CONSTRAINT DF_GroupMemberIsAdmin DEFAULT 0 WITH VALUES;
