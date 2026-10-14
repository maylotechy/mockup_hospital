# IRDSS Referral Flows

These three diagrams describe the intended completed system, using the current direct patient-transfer privacy design. They are presentation diagrams, not a claim that full FHIR Bundle validation and every target workflow are implemented today.

| View | Mermaid source | Presentation image |
| --- | --- | --- |
| Referring facility | [Source](referring-facility-target-flow.mmd) | [PNG](referring-facility-target-flow.png) |
| Receiving facility | [Source](receiving-facility-target-flow.mmd) | [PNG](receiving-facility-target-flow.png) |
| Central IoL | [Source](iol-target-flow.mmd) | [PNG](iol-target-flow.png) |

The sending hospital retains the full referral Bundle encrypted locally. The IoL receives a minimized routing Bundle without direct patient identifiers, stores routing/workflow information in PostgreSQL, screens facilities using rules, collects confirmations, and ranks the confirmed facilities. The referring clinician chooses the final destination.

A facility's confirmation means it can receive the patient; it does not yet grant access to the full identity. Only the finalized receiving facility gets short-lived transfer authorization. It retrieves the full recipient-encrypted Bundle directly from the sender, verifies the signature, and decrypts it using its private key. On arrival, it imports the patient into its encrypted hospital database. IoL receives status updates rather than the identity package.

The earlier temporary central identity database/vault is therefore replaced by two components: **central routing and workflow storage** and **direct authorized hospital-to-hospital transfer**. The full patient identity never needs to pass through the IoL in this target design. In a shared hospital platform, the direct exchange takes place between authorized hospital contexts within the shared backend.

SVG versions are included beside each PNG for resizing and print use. The existing architecture/workflow diagrams remain separate.
