# BEN Registry Guard

HOME-55 prevents invalid BEN registry state before Jira persists it.

`BEN Registry Record` is the single registry authority. It contains lifecycle and the remaining registry metadata in one validated object, so Jira workflow status, labels, Description text, and links cannot form a contradictory registry state.

## Safety properties

1. Registry participation requires a valid BEN Registry Record; absence means non-registry work.
2. Candidate Evaluation results are valid only on Completed records.
3. Completed notable findings are canonical record data instead of post-cutover Description parsing.
4. A source is resolved when first set or changed. An unchanged stored source remains historical authority even if that source is later deleted or no longer visible.
5. JSON schema rejects unknown properties at every object level.
6. Bulk edit is intentionally not enabled because Forge bulk validation does not expose the issue context needed for safe historical-source handling.
7. Production code must not use Forge's private field-update API because it bypasses custom-field validation.

## Cutover gates

1. Register the Forge app and replace `${APP_ID}` with the real app identity.
2. Deploy/install the app and add BEN Registry Record to the BEN project.
3. Verify the supported create/edit surfaces use the field validator.
4. Migrate only legacy records that map uniquely to a valid canonical record.
5. Prove migration parity before changing Homepage Dashboard registry acquisition.
6. Cut the Dashboard query/projector to BEN Registry Record only.
7. Remove legacy lifecycle/result/source authority after parity verification.
8. Verify UI, REST edit, automation, import, and disabled bulk-edit behavior on the exact candidate.
9. Run Forge CLI lint/deploy validation and production smoke verification before merge.

## Local checks

```sh
cd jira/ben-registry-guard
npm test
```

The PR remains draft until the real Forge identity, deployment, migration, Dashboard cutover, and production verification are complete.
