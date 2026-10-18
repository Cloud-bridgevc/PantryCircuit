# HubSpot CRM plan

Status: **plan only**. Nothing here is configured in a HubSpot account. The website's demo form is wired to the HubSpot Forms API (`src/crm/demoRequest.mjs`, `lambda/demo-request.mjs`) and works once a portal ID and form GUID are supplied.

## 1. Data model

| Object | Use | Notes |
|---|---|---|
| Contact | Person requesting a demo / user | Lifecycle stage: Lead → MQL → SQL → Opportunity → Customer |
| Company | Restaurant group, caterer, kitchen operator **or** supplier | `pc_company_type` separates customers from suppliers |
| Deal | Sales opportunity | Two pipelines (below) |
| Ticket | Onboarding and support | Onboarding pipeline (below) |

### Custom properties
| Internal name | Object | Type | Source |
|---|---|---|---|
| `pc_business_type` | Contact | Enum: restaurant_group, single_restaurant, caterer, commercial_kitchen, supplier_distributor, other | Demo form |
| `pc_location_count` | Contact | Number | Demo form |
| `pc_demo_notes` | Contact | Multi-line text | Demo form |
| `pc_company_type` | Company | Enum: customer_prospect, supplier_partner | Workflow |
| `pc_location_count_total` | Company | Number | Sales / product |
| `pc_product_org_id` | Company | Text | Product (set at provisioning) |
| `pc_onboarding_stage` | Company | Enum | Onboarding workflow |
| `pc_last_forecast_run` | Company | Date | Product sync (daily) |
| `pc_active_locations_30d` | Company | Number | Product sync |

Product-usage properties hold **counts and dates only**: no sales, recipes, supplier prices or stock data leave the product database.

## 2. Pipelines

**Customer pipeline** (restaurant groups, caterers, commercial kitchens): Demo requested → Demo scheduled → Demo held → Data-fit check (can they export sales history and recipes?) → Pilot → Proposal → Closed won / Closed lost.

**Supplier partnership pipeline**: Identified → Intro call → Catalogue shared (price file / API / CSV) → Pilot with a customer → Active partner → Paused. A supplier is a *Company* with `pc_company_type = supplier_partner`; contacts attach normally.

**Onboarding ticket pipeline**: Kickoff → Data received → Recipes mapped → Stock counts loaded → First forecast reviewed → First two weeks live → Handover to support.

## 3. Workflows

1. **Demo request intake** (trigger: form submission): create/update contact and company; set lifecycle = Lead; route by `pc_business_type` and `pc_location_count`:
   - restaurant_group or ≥ 5 locations → owner = group-accounts rep, create Customer deal at "Demo requested", task due in 1 business day.
   - caterer / commercial_kitchen / single_restaurant → owner = round-robin, create deal.
   - supplier_distributor → no customer deal; create Supplier-pipeline deal at "Identified", notify partnerships lead.
   - Send confirmation email with the booking link. Internal Slack/email notification.
2. **Demo scheduling**: HubSpot Meetings link (round-robin per segment). On booking → deal stage "Demo scheduled"; reminder email 24 h before; on no-show after 30 min → task + reschedule email; on meeting outcome "Completed" → "Demo held" and send a follow-up that includes the questions in the data-fit check.
3. **Data-fit check** (deal stage): checklist task for the rep: sales export available? recipe quantities available? stock-count method? supplier price lists? Result recorded in deal properties; blocks "Pilot" until answered.
4. **Closed-won → onboarding**: create the Onboarding ticket set from a template, create the product organisation (via internal API; stores `pc_product_org_id`), send welcome email with the CSV import guide, assign the onboarding owner.
5. **Onboarding nudges**: if "Data received" not reached within 7 days of kickoff → task and email to the customer contact; if no forecast run within 14 days → escalate to the onboarding lead.
6. **Supplier partnership**: on "Catalogue shared" create a task to load offers into the supplier catalogue and validate pack size / MOQ / lead-time fields; on "Pilot" link to the customer company that uses them.
7. **Re-engagement**: deal Closed-lost with reason "Timing" → nurture sequence after 90 days (opt-in contacts only).

## 4. Product ↔ HubSpot sync

A daily Lambda (not yet built) reads aggregate counts from PostgreSQL and updates Company properties through the HubSpot CRM API with a private-app token held in AWS Secrets Manager. Inbound: HubSpot webhook on deal stage = Closed won triggers provisioning. Failure handling: retry with backoff, dead-letter queue, alarm on repeated failures.

## 5. Reporting
Demo-request → demo-held → pilot → won conversion by segment; time in each stage; onboarding time-to-first-forecast; supplier partners by stage. These are measured from real activity; no outcome claims are made in advance.

## 6. Privacy and consent
- The form includes an explicit consent checkbox; the submission passes `legalConsentOptions` to HubSpot. Marketing email follows HubSpot subscription types; no pre-ticked boxes.
- Collect only name, work email, company, role, business type, location count, optional notes.
- Honeypot field plus API throttling for spam. Data-processing agreement and retention policy to be agreed before launch.

## 7. Setup checklist
1. Create custom properties above. 2. Create the form and note portal ID / form GUID. 3. Create pipelines, meetings links and workflows. 4. Set `HubSpotPortalId` / `HubSpotFormGuid` stack parameters. 5. Test with a sandbox portal before production.
