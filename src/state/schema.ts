import * as v from "valibot";

// Profile IDs become managed auth file names, so they must not contain path separators.
const ProfileIdSchema = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9_-]+$/, "Profile ID must contain only letters, digits, '-' or '_'."),
);

export const AccountRecordSchema = v.object({
  profileId: ProfileIdSchema,
  email: v.pipe(v.string(), v.email()),
  accountId: v.string(),
  authPath: v.optional(v.string()),
  createdAt: v.string(),
  lastUsedAt: v.string(),
});

export const AppStateSchema = v.pipe(
  v.object({
    currentProfileId: v.nullable(ProfileIdSchema),
    accounts: v.record(ProfileIdSchema, AccountRecordSchema),
  }),
  v.check(
    (state) => Object.entries(state.accounts).every(([key, account]) => key === account.profileId),
    "Account entries must be keyed by their profile ID.",
  ),
  v.check(
    (state) => state.currentProfileId === null || Object.hasOwn(state.accounts, state.currentProfileId),
    "Current profile ID must reference a saved account.",
  ),
);
