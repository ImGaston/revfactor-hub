# Native V1 deployment

Follow [INSTALLATION.md](INSTALLATION.md) for the installed hosts, build-time endpoint configuration, capture/transport guards, native settings, tests and remaining pilot gates. This supersedes the earlier proposed outer-host and native-upsert approach.

## Signed document property scope gate

Root verifies authenticated GHL document `fillableFields` (`fieldId`, `hasCompleted`, `value`) against structured commercial scope. Configure `GHL_V1_CONTRACT_FIELDS_JSON` with `legalNameFieldId` and ordered `propertyAddressFieldIds`. Address comparison format is `[street, unit, city, region, postalCode, country].filter(Boolean).join(', ')`.

Existing native commercial templates were not changed by this lane. Their real field IDs, required completion and consistent itemized property-address fields must be proven before automatic verification. Matching the monthly total alone is insufficient. If templates vary, use a reviewed per-template mapping.

## Rollback

Keep the backend route disabled and stop enrolling V1 links. Preserve the installed fail-closed guards and evidence; do not restore unguarded native submission as a rollback. No customer state was created in this lane.
