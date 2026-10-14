# Project Plans

All project planning documents are grouped here. Source-code paths inside the plans are relative to the project root unless stated otherwise. Refer to each document for its own progress and scope.

| Plan | Purpose |
| --- | --- |
| [FHIR migration](plan.md) | Overall migration of referral exchange to FHIR. |
| [JavaScript modularization](APP_JS_REFACTOR_PLAN.md) | Completed extraction of `app.js` into feature modules. |
| [Clinical data and terminology](FHIR_CLINICAL_DATA_REFACTOR_PLAN.md) | SNOMED CT, clinical resources, LOINC and UCUM implementation. |
| [Privacy-first referral exchange](PRIVACY_FIRST_REFERRAL_REFACTOR_PLAN.md) | Patient-data minimization, local encryption and secure exchange. |
| [PHP frontend templates](FRONTEND_PHP_TEMPLATE_REFACTOR_PLAN.md) | Planned split of the large HTML page into PHP views. |
| [Implementation notes and todos](implementation_plan.md) | Additional referral and patient workflow planning notes. |

Implementation guides, reports, examples and architecture diagrams remain in `../docs/`; this folder is for plans only. Moving the documents does not change application behavior or completion status.
