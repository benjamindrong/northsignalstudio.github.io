# BEN Registry Guard

HOME-55 prevents invalid BEN registry tickets before Jira persists them.

This Forge app owns the pre-persistence validation boundary. Registry lifecycle is the exact Jira workflow status; `BEN Registry Record` owns the remaining registry metadata. The manifest is generated from `src/contract-definition.mjs` so field validation and workflow validation cannot drift into separate rule sets.

## Merge gates

1. Register the Forge app and set `APP_ID`; do not commit a fabricated app ID.
2. Create the dedicated BEN registry work type and exact lifecycle workflow: Unused, Preparing, Blocked, Running, Completed, Retired.
3. Configure `BEN_REGISTRY_FIELD_KEY` and `BEN_REGISTRY_ISSUE_TYPE_ID` from the deployed Jira identities.
4. Scope the Forge field to the registry work type and make it required there.
5. Attach the Forge workflow validator to every lifecycle transition.
6. Keep `BEN_REGISTRY_MIGRATION_KEYS` limited to the one-time verified migration set, then redeploy with it empty before cutover.
7. Do not enable bulk edit for BEN Registry Record.
8. Migrate only records that map uniquely from the current valid registry state.
9. Cut Homepage Dashboard over only after migration and parity verification pass.
10. Remove legacy registry lifecycle/result/source authority from migrated tickets before completion.

## Local checks

```sh
cd jira/ben-registry-guard
npm test
```

The current PR must remain draft until the Forge app is registered, Jira configuration is installed, migration is complete, and exact-candidate production verification passes.
