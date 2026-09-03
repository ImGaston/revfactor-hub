# University official-source audit

Status: researched and adapter scaffold complete on 2026-09-03. Collection remains disabled and is not activation-ready until the reconciliation work below is complete. No source, event, market, listing assignment, or commercial action is activated by this work.

## Source precedence

1. The institution's ceremony- or family-program page is the canonical date authority.
2. The registrar calendar is corroborating evidence and a future-year placeholder until the program page rolls forward.
3. Official athletics schedules are the authority for home games and changing kickoff times.
4. General campus calendars and news releases are supplemental discovery only.

Conflicts are evidence, not permission to overwrite silently. For example, UT Knoxville's spring 2027 ceremony page says May 13–16 while its registrar calendar says May 14–17. The ceremony page must win operationally and both observations must remain auditable. The current adapter records authority tiers but does not yet perform this cross-source reconciliation, so no source should be activated until that layer is implemented and tested.

## Pilot registry

| Institution       | Signal                    | Preferred source                                                                        | Format                                      | Cadence after approval                                    | Notes                                                                                                                      |
| ----------------- | ------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| UConn             | Family Weekend            | `familyweekend.uconn.edu`                                                               | HTML                                        | Daily during announcement/registration; weekly otherwise  | Current page publishes Sep 25–27, 2026. A discoverable LiveWhale iCal item is stale from 2023 and is not a current source. |
| UConn             | Commencement              | `commencement.uconn.edu/may/`                                                           | HTML tables                                 | Daily Jan–May; weekly otherwise                           | Registrar calendar supplies future-year weekend placeholders.                                                              |
| UConn             | Academic calendar         | `registrar.uconn.edu/academic-calendar/`                                                | HTML tables                                 | Weekly                                                    | Current page publishes May 8–9, 2027. A five-year XLSX exists for a later collector slice.                                 |
| UConn             | Football                  | `uconnhuskies.com/sports/football/schedule/text`                                        | HTML table                                  | Daily in season; weekly otherwise                         | CFBD remains the structured provider; official schedule is verification. Honor the published 30-second crawl delay.        |
| UT Knoxville      | Family Reunions           | `studentlife.utk.edu/family/events/vol-family-reunions/` via first-party WordPress REST | JSON-wrapped HTML                           | Daily in announcement season; weekly otherwise            | Two distinct 2026 occurrences: Sep 18–20 and Oct 16–18.                                                                    |
| UT Knoxville      | Commencement              | `commencement.utk.edu` and year-specific ceremony pages                                 | HTML / WordPress REST                       | Daily near announcements and ceremonies; weekly otherwise | Ceremony-specific dates take precedence over registrar dates.                                                              |
| UT Knoxville      | Academic calendar         | `registrar.utk.edu/wp-json/academic-calendar/v1/dates?keyword=Commencement`             | JSON-wrapped HTML with per-event iCal links | Daily                                                     | Broad corroborating registry; query results must still be locally filtered.                                                |
| UT Knoxville      | Football                  | `utsports.com/sports/football/schedule/text`                                            | HTML table                                  | Daily in season; weekly otherwise                         | CFBD remains primary structured input. Honor the published 30-second crawl delay.                                          |
| George Washington | Alumni & Families Weekend | `alumnifamiliesweekend.gwu.edu`                                                         | HTML                                        | Daily during announcement/registration; weekly otherwise  | Current page publishes Oct 16–18, 2026. Its add-to-calendar link is third-party, so HTML remains authoritative.            |
| George Washington | Commencement              | `commencement.gwu.edu`                                                                  | HTML                                        | Daily Jan–May; weekly otherwise                           | Page rollover can lag the registrar calendar.                                                                              |
| George Washington | Academic calendar         | `gwu.edu/academic-calendar`                                                             | HTML tables                                 | Weekly                                                    | Publishes commencement weekends through multiple future years.                                                             |
| George Washington | General events            | `calendar.gwu.edu/api/2/events?keyword=...`                                             | Localist JSON                               | Supplemental only                                         | Post-filter every result and back off on 429. It is not the canonical graduation/family date source.                       |

GW has no varsity football. High-demand home basketball and other athletics can be added in a later sports-source slice.

## Adapter boundary

The official-page adapter accepts non-recurring iCalendar events, Event JSON-LD, bounded HTML, and JSON-wrapped HTML. It enforces HTTPS, an application-reviewed institution/domain allowlist, revalidated redirects, one overall ten-second request deadline, a 512 KiB response ceiling, explicit event match rules and exclusions, a three-year maximum horizon, parser-health minimums, and a 50-event source cap. Third-party outbound links cannot become Tier-1 evidence. It never infers attendance. Recurring iCalendar rules fail closed until a bounded recurrence collector exists.

Execution requires three independent approvals: the source configuration must move from `registry_only` to `enabled`, the individual row must be active, and `UNIVERSITY_PAGE_INGESTION_ENABLED=true` must be set. The default is false. The adapter is read-only; it cannot write PriceLabs, PMS/OTA settings, minimum stays, or arrival/departure restrictions.

## Activation blockers

Before any row moves to `enabled`, add and test cross-source occurrence reconciliation using the foundation's event-series identity. It must preserve both canonical and corroborating observations, apply the precedence policy above, and mark previously observed future occurrences stale or review-required when a complete source snapshot no longer contains them. The current source-level synthetic identity can track an HTML date move within one configured occurrence slot, but it is not a substitute for that cross-source series layer.

Activation also requires source-specific snapshots from the live page shapes and an explicit decision for pages that legitimately have zero future matches between announcement cycles. The default parser-health minimum is one event, so a silent page redesign fails the source run instead of advancing health as if collection succeeded.

## Release dependency

Migration `20260902203500_university_official_page_adapter_configs.sql` depends on the separate five-file RF-INTEL-001 foundation (`20260902203000`–`20260902203400`). Do not add it to or change the frozen five-file release manifest. Apply it only as a later isolated release after the foundation postflight is green.
