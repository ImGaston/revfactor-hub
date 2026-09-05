# Design review

## Native GHL onboarding visual refresh — 2026-09-04

**Findings:** The native form repeated known address inputs and placed help below a long form. Native inline layout defaults needed scoped overrides. The form footer must stay within its existing guarded parent.

**Severity:** Medium for repeated information/help reachability; high for any change that breaks guard containment or invents completed progress.

**Fix:** Applied the user-approved sidebar/white-panel redesign with RevFactor cedar/bone palette, mobile progress, visible focus, readable labels and original native field IDs. Known identity is shown once after hydration. Sidebar help is accessible, desktop content is sticky, and native form/footer nodes remain in place. Fifteen host/presentation tests and both adapters pass. Real GHL visual proof is recorded under `docs/ghl/native-v1/evidence`; end-to-end commercial activation remains a separate release gate.
