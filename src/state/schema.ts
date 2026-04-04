import * as v from "valibot";

export const AccountRecordSchema = v.object({
  profileId: v.string(),
  email: v.pipe(v.string(), v.email()),
  accountId: v.string(),
  authPath: v.optional(v.string()),
  createdAt: v.string(),
  lastUsedAt: v.string(),
});

export const AppStateSchema = v.object({
  currentProfileId: v.nullable(v.string()),
  accounts: v.record(v.string(), AccountRecordSchema),
});
