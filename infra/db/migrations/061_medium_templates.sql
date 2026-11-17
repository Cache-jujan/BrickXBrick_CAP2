-- 061_medium_templates.sql
-- Adds a "medium" size and seeds 7 medium project templates (one per project
-- type, except Other), generated from infra/db/templates/project-templates.json.
-- Edit the JSON, not this file, and add a new migration if the catalog changes
-- after this has been applied.
--
-- How a medium template is built (draft, for review): the Planning milestones
-- come from the Small template of the same type (same permit documents), and
-- the Construction milestones come from the Large template with their timeline
-- shortened to the midpoint between Small and Large. Structure only: no BOM
-- data, quantities, prices, assignees or progress. Due offsets are ESTIMATES
-- and still need validating with the contractor/adviser.
--
-- Safe to re-run: the CHECK is replaced and every insert skips existing rows.

ALTER TABLE project_templates DROP CONSTRAINT IF EXISTS project_templates_size_check;
ALTER TABLE project_templates ADD CONSTRAINT project_templates_size_check
  CHECK (size IN ('small', 'medium', 'large', 'custom'));

-- Residential Building: medium
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('residential-medium', 'Residential Building — medium', 'Residential Building', 'medium', 'Medium residential build such as a two-storey house or a small multi-unit dwelling.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Project Setup and Permit Documents', 'Planning', 21),
  (2, 'Permits and Pre-Construction', 'Planning', 51),
  (3, 'Earthworks and Foundations', 'Construction', 36),
  (4, 'Structural Frame and Building Envelope', 'Construction', 79),
  (5, 'MEP Rough-In and Interior Works', 'Construction', 112),
  (6, 'External Works and Testing', 'Construction', 134),
  (7, 'Closeout and Occupancy', 'Construction', 149)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'residential-medium'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm client, owner, site, and project scope', 'GM', NULL, TRUE, NULL, 2),
  (1, 2, 'Assign supervising architect or engineer', 'GM', NULL, TRUE, NULL, 3),
  (1, 3, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 5),
  (1, 4, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 6),
  (1, 5, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 8),
  (1, 6, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 9),
  (1, 7, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 11),
  (1, 8, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 12),
  (1, 9, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 14),
  (1, 10, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 15),
  (1, 11, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 17),
  (1, 12, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 18),
  (1, 13, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 20),
  (1, 14, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 21),
  (2, 1, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 23),
  (2, 2, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 25),
  (2, 3, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 27),
  (2, 4, 'Certified tax declaration and current tax clearance', 'GM', 'COND-TAX-DECLARATION', FALSE, 'When required by the local checklist', 29),
  (2, 5, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 31),
  (2, 6, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 33),
  (2, 7, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 35),
  (2, 8, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 37),
  (2, 9, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 39),
  (2, 10, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 41),
  (2, 11, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 43),
  (2, 12, 'Submit building and ancillary permit application', 'PM', NULL, TRUE, NULL, 45),
  (2, 13, 'Resolve permit corrections', 'PM', NULL, TRUE, NULL, 47),
  (2, 14, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 49),
  (2, 15, 'Conduct site turnover and safety orientation', 'PM', NULL, TRUE, NULL, 51),
  (3, 1, 'Set up site office, storage, safety controls, and project billboard', NULL, NULL, TRUE, NULL, 5),
  (3, 2, 'Conduct pre-construction meeting and site turnover', NULL, NULL, TRUE, NULL, 10),
  (3, 3, 'Complete survey and setting out', NULL, NULL, TRUE, NULL, 17),
  (3, 4, 'Complete excavation and earthworks', NULL, NULL, TRUE, NULL, 23),
  (3, 5, 'Complete footings, foundations, waterproofing, and backfill', NULL, NULL, TRUE, NULL, 29),
  (3, 6, 'Complete slabs and underground sleeves', NULL, NULL, TRUE, NULL, 36),
  (4, 1, 'Complete lower-level structural works', NULL, NULL, TRUE, NULL, 47),
  (4, 2, 'Complete upper-level structural works', NULL, NULL, TRUE, NULL, 57),
  (4, 3, 'Complete roof structure and roofing', NULL, NULL, TRUE, NULL, 68),
  (4, 4, 'Complete masonry, windows, doors, and waterproofing', NULL, NULL, TRUE, NULL, 79),
  (5, 1, 'Complete electrical rough-in and panel preparation', NULL, NULL, TRUE, NULL, 87),
  (5, 2, 'Complete plumbing and sanitary rough-in', NULL, NULL, TRUE, NULL, 96),
  (5, 3, 'Complete mechanical or special systems when applicable', NULL, NULL, TRUE, NULL, 104),
  (5, 4, 'Complete ceilings, partitions, floors, cabinets, and finishes', NULL, NULL, TRUE, NULL, 112),
  (6, 1, 'Complete drainage and utility connections', NULL, NULL, TRUE, NULL, 118),
  (6, 2, 'Complete driveway, fence, landscaping, and external works', NULL, NULL, TRUE, NULL, 123),
  (6, 3, 'Test electrical, plumbing, sanitary, and other installed systems', NULL, NULL, TRUE, NULL, 129),
  (6, 4, 'Resolve inspection findings', NULL, NULL, TRUE, NULL, 134),
  (7, 1, 'Complete final inspections', NULL, NULL, TRUE, NULL, 137),
  (7, 2, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 140),
  (7, 3, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 143),
  (7, 4, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 146),
  (7, 5, 'Complete final punch list and client turnover', NULL, NULL, TRUE, NULL, 149)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'residential-medium'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Commercial Building: medium
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('commercial-medium', 'Commercial Building — medium', 'Commercial Building', 'medium', 'Medium commercial building such as a small shop, office, or multi-tenant premises.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Commercial Scope and Permits', 'Planning', 30),
  (2, 'Mobilization and Site Works', 'Construction', 29),
  (3, 'Structure and Building Envelope', 'Construction', 78),
  (4, 'MEP, Fire Protection, and Interior Works', 'Construction', 117),
  (5, 'Systems Testing and Regulatory Inspection', 'Construction', 137),
  (6, 'Occupancy and Handover', 'Construction', 150)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'commercial-medium'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm business use, occupancy, site, and client requirements', 'GM', NULL, TRUE, NULL, 1),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 2),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 3),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 4),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 5),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 6),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 7),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 8),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 9),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 10),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 11),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 12),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 13),
  (1, 14, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 14),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 15),
  (1, 16, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 15),
  (1, 17, 'Certified tax declaration and current tax clearance', 'GM', 'COND-TAX-DECLARATION', FALSE, 'When required by the local checklist', 16),
  (1, 18, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 17),
  (1, 19, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 18),
  (1, 20, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 19),
  (1, 21, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 20),
  (1, 22, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 21),
  (1, 23, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 22),
  (1, 24, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 23),
  (1, 25, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 24),
  (1, 26, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 25),
  (1, 27, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 26),
  (1, 28, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 27),
  (1, 29, 'Sign permit', 'PM', 'COND-SIGN', FALSE, 'When a regulated project sign or permanent sign is installed', 28),
  (1, 30, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 29),
  (1, 31, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 30),
  (2, 1, 'Set up site facilities, safety controls, and project billboard', NULL, NULL, TRUE, NULL, 15),
  (2, 2, 'Complete survey, earthworks, excavation, and foundations', NULL, NULL, TRUE, NULL, 29),
  (3, 1, 'Complete structural frame by level or zone', NULL, NULL, TRUE, NULL, 46),
  (3, 2, 'Complete roof and waterproofing', NULL, NULL, TRUE, NULL, 62),
  (3, 3, 'Complete walls, windows, doors, and external envelope', NULL, NULL, TRUE, NULL, 78),
  (4, 1, 'Complete electrical and communications rough-in', NULL, NULL, TRUE, NULL, 88),
  (4, 2, 'Complete plumbing and sanitary systems', NULL, NULL, TRUE, NULL, 98),
  (4, 3, 'Complete mechanical and fire-protection systems when applicable', NULL, NULL, TRUE, NULL, 108),
  (4, 4, 'Complete partitions, ceilings, floors, and finishes', NULL, NULL, TRUE, NULL, 117),
  (5, 1, 'Test and commission installed systems', NULL, NULL, TRUE, NULL, 124),
  (5, 2, 'Conduct fire-safety inspection preparation', NULL, NULL, TRUE, NULL, 130),
  (5, 3, 'Resolve technical and regulatory deficiencies', NULL, NULL, TRUE, NULL, 137),
  (6, 1, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 139),
  (6, 2, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 141),
  (6, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 144),
  (6, 4, 'Complete final punch list', NULL, NULL, TRUE, NULL, 146),
  (6, 5, 'Deliver operations, warranty, and closeout records', NULL, NULL, TRUE, NULL, 149),
  (6, 6, 'Turn over the completed commercial building', NULL, NULL, TRUE, NULL, 150)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'commercial-medium'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Fit-out / Renovation: medium
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('fitout-renovation-medium', 'Fit-out / Renovation — medium', 'Fit-out / Renovation', 'medium', 'Medium renovation or fit-out covering several rooms or a full floor.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Existing Condition and Permit Review', 'Planning', 21),
  (2, 'Phased Mobilization and Protection', 'Construction', 10),
  (3, 'Demolition and Structural Alterations', 'Construction', 36),
  (4, 'Building Systems and Fit-Out', 'Construction', 69),
  (5, 'Testing, Corrections, and Closeout', 'Construction', 89)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'fitout-renovation-medium'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Inspect and document existing conditions', 'PM', NULL, TRUE, NULL, 1),
  (1, 2, 'Confirm scope, occupancy, and work boundaries', 'GM', NULL, TRUE, NULL, 2),
  (1, 3, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 3),
  (1, 4, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 4),
  (1, 5, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 4),
  (1, 6, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 5),
  (1, 7, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 6),
  (1, 8, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 7),
  (1, 9, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 8),
  (1, 10, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 9),
  (1, 11, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 10),
  (1, 12, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 11),
  (1, 13, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 11),
  (1, 14, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 12),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 13),
  (1, 16, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 14),
  (1, 17, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 15),
  (1, 18, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 16),
  (1, 19, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 17),
  (1, 20, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 18),
  (1, 21, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 18),
  (1, 22, 'Sign permit', 'PM', 'COND-SIGN', FALSE, 'When a regulated project sign or permanent sign is installed', 19),
  (1, 23, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 20),
  (1, 24, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 21),
  (2, 1, 'Prepare phased work zones and access controls', NULL, NULL, TRUE, NULL, 4),
  (2, 2, 'Set up safety, dust, noise, and temporary-utility controls', NULL, NULL, TRUE, NULL, 7),
  (2, 3, 'Conduct pre-work inspection and client turnover of work areas', NULL, NULL, TRUE, NULL, 10),
  (3, 1, 'Complete approved demolition by zone', NULL, NULL, TRUE, NULL, 19),
  (3, 2, 'Complete structural strengthening or alterations when applicable', NULL, NULL, TRUE, NULL, 27),
  (3, 3, 'Complete disposal, protection, and inspection of exposed conditions', NULL, NULL, TRUE, NULL, 36),
  (4, 1, 'Complete electrical and communications works', NULL, NULL, TRUE, NULL, 47),
  (4, 2, 'Complete plumbing, sanitary, mechanical, and fire-safety works', NULL, NULL, TRUE, NULL, 58),
  (4, 3, 'Complete partitions, ceilings, floors, finishes, and fixtures by zone', NULL, NULL, TRUE, NULL, 69),
  (5, 1, 'Test and commission all affected systems', NULL, NULL, TRUE, NULL, 72),
  (5, 2, 'Complete authority and client inspections', NULL, NULL, TRUE, NULL, 75),
  (5, 3, 'Resolve punch-list and compliance findings', NULL, NULL, TRUE, NULL, 79),
  (5, 4, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 82),
  (5, 5, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 85),
  (5, 6, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 89)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'fitout-renovation-medium'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Civil Works: medium
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('civil-works-medium', 'Civil Works — medium', 'Civil Works', 'medium', 'Medium civil works such as site development or concrete works across several areas.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Survey, Design, and Clearances', 'Planning', 21),
  (2, 'Mobilization and Temporary Works', 'Construction', 14),
  (3, 'Earthworks and Substructure', 'Construction', 46),
  (4, 'Main Civil Works', 'Construction', 87),
  (5, 'Restoration, Inspection, and Handover', 'Construction', 102)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'civil-works-medium'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm site limits, scope, and affected public areas', 'GM', NULL, TRUE, NULL, 1),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 2),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 3),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 4),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 4),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 5),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 6),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 7),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 8),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 9),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 10),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 11),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 11),
  (1, 14, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 12),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 13),
  (1, 16, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 14),
  (1, 17, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 15),
  (1, 18, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 16),
  (1, 19, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 17),
  (1, 20, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 18),
  (1, 21, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 18),
  (1, 22, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 19),
  (1, 23, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 20),
  (1, 24, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 21),
  (2, 1, 'Set up site facilities, safety controls, traffic controls, and project billboard', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Establish benchmarks, access, drainage protection, and temporary works', NULL, NULL, TRUE, NULL, 10),
  (2, 3, 'Conduct pre-construction meeting', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete clearing, demolition, excavation, and disposal', NULL, NULL, TRUE, NULL, 25),
  (3, 2, 'Complete subgrade, embankment, backfill, and compaction', NULL, NULL, TRUE, NULL, 35),
  (3, 3, 'Complete foundations, drainage, and underground works', NULL, NULL, TRUE, NULL, 46),
  (4, 1, 'Complete structural or concrete works by zone', NULL, NULL, TRUE, NULL, 59),
  (4, 2, 'Complete utilities, drainage, curbs, pavement, or site structures', NULL, NULL, TRUE, NULL, 73),
  (4, 3, 'Perform quality checks and required tests', NULL, NULL, TRUE, NULL, 87),
  (5, 1, 'Complete surface restoration and environmental controls', NULL, NULL, TRUE, NULL, 90),
  (5, 2, 'Resolve authority and client inspection findings', NULL, NULL, TRUE, NULL, 95),
  (5, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 98),
  (5, 4, 'Turn over the completed civil works', NULL, NULL, TRUE, NULL, 102)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'civil-works-medium'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Structural Retrofitting: medium
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('structural-retrofitting-medium', 'Structural Retrofitting — medium', 'Structural Retrofitting', 'medium', 'Medium structural repair or strengthening covering several members or areas.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Assessment, Design, and Approval', 'Planning', 28),
  (2, 'Phased Mobilization and Temporary Works', 'Construction', 15),
  (3, 'Structural Strengthening by Zone', 'Construction', 58),
  (4, 'Restoration and Systems Coordination', 'Construction', 79),
  (5, 'Final Inspection and Handover', 'Construction', 94)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'structural-retrofitting-medium'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Inspect and document existing structural conditions', 'PM', NULL, TRUE, NULL, 1),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 3),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 4),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 5),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 7),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 8),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 9),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 11),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 12),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 13),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 15),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 16),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 17),
  (1, 14, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 19),
  (1, 15, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 20),
  (1, 16, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 21),
  (1, 17, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 23),
  (1, 18, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 24),
  (1, 19, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 25),
  (1, 20, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 27),
  (1, 21, 'Receive approved permits and professional sign-offs', 'PM', NULL, TRUE, NULL, 28),
  (2, 1, 'Prepare work zones and occupant protection', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Install temporary supports and monitoring points', NULL, NULL, TRUE, NULL, 10),
  (2, 3, 'Conduct pre-work inspection and approve the phase sequence', NULL, NULL, TRUE, NULL, 15),
  (3, 1, 'Complete demolition and exposure works by zone', NULL, NULL, TRUE, NULL, 29),
  (3, 2, 'Complete strengthening, repair, and connection works', NULL, NULL, TRUE, NULL, 43),
  (3, 3, 'Perform inspections and tests before closing each zone', NULL, NULL, TRUE, NULL, 58),
  (4, 1, 'Restore affected architectural finishes', NULL, NULL, TRUE, NULL, 65),
  (4, 2, 'Reinstate electrical, plumbing, sanitary, and fire-safety systems', NULL, NULL, TRUE, NULL, 72),
  (4, 3, 'Remove temporary works after engineer approval', NULL, NULL, TRUE, NULL, 79),
  (5, 1, 'Complete final structural inspection and documentation', NULL, NULL, TRUE, NULL, 82),
  (5, 2, 'Resolve punch-list and authority findings', NULL, NULL, TRUE, NULL, 84),
  (5, 3, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 87),
  (5, 4, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 89),
  (5, 5, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 92),
  (5, 6, 'Turn over the retrofitted structure', NULL, NULL, TRUE, NULL, 94)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'structural-retrofitting-medium'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Drainage / Flood Control: medium
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('drainage-flood-control-medium', 'Drainage / Flood Control — medium', 'Drainage / Flood Control', 'medium', 'Medium drainage or flood-control work such as a canal section or several culverts.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Survey, Hydrology, and Clearances', 'Planning', 28),
  (2, 'Mobilization and Temporary Water Management', 'Construction', 15),
  (3, 'Earthworks and Main Drainage Structures', 'Construction', 59),
  (4, 'Testing, Restoration, and Environmental Compliance', 'Construction', 80),
  (5, 'As-Built and Handover', 'Construction', 90)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'drainage-flood-control-medium'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm catchment, flow path, affected properties, and work limits', 'PM', NULL, TRUE, NULL, 1),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 3),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 4),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 5),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 6),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 8),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 9),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 10),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 11),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 13),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 14),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 15),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 17),
  (1, 14, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 18),
  (1, 15, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 19),
  (1, 16, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 20),
  (1, 17, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 22),
  (1, 18, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 23),
  (1, 19, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 24),
  (1, 20, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 25),
  (1, 21, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 27),
  (1, 22, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 28),
  (2, 1, 'Set up safety, traffic, environmental, and community controls', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Install temporary diversion, bypass, dewatering, or protection works', NULL, NULL, TRUE, NULL, 10),
  (2, 3, 'Conduct pre-construction meeting and establish inspection points', NULL, NULL, TRUE, NULL, 15),
  (3, 1, 'Complete clearing, excavation, and foundation preparation by zone', NULL, NULL, TRUE, NULL, 30),
  (3, 2, 'Construct canals, culverts, outfalls, retaining structures, or flood-control works', NULL, NULL, TRUE, NULL, 44),
  (3, 3, 'Complete backfill, embankment, erosion protection, and utility interfaces', NULL, NULL, TRUE, NULL, 59),
  (4, 1, 'Test flow capacity and inspect structures', NULL, NULL, TRUE, NULL, 64),
  (4, 2, 'Restore roads, sidewalks, properties, and affected utilities', NULL, NULL, TRUE, NULL, 70),
  (4, 3, 'Complete environmental and safety closeout actions', NULL, NULL, TRUE, NULL, 75),
  (4, 4, 'Resolve inspection findings', NULL, NULL, TRUE, NULL, 80),
  (5, 1, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 84),
  (5, 2, 'Document maintenance and operating requirements', NULL, NULL, TRUE, NULL, 87),
  (5, 3, 'Complete final inspection and turn over the system', NULL, NULL, TRUE, NULL, 90)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'drainage-flood-control-medium'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Road Maintenance: medium
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('road-maintenance-medium', 'Road Maintenance — medium', 'Road Maintenance', 'medium', 'Medium road maintenance covering several road sections.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Survey, Traffic Plan, and Clearances', 'Planning', 14),
  (2, 'Traffic Management and Mobilization', 'Construction', 9),
  (3, 'Drainage, Subgrade, and Base Works', 'Construction', 28),
  (4, 'Pavement and Roadside Works', 'Construction', 57),
  (5, 'Final Inspection and Handover', 'Construction', 66)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'road-maintenance-medium'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Inspect pavement condition and confirm repair limits', 'PM', NULL, TRUE, NULL, 1),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 1),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 2),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 3),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 4),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 4),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 5),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 6),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 6),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 7),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 8),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 8),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 9),
  (1, 14, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 10),
  (1, 15, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 11),
  (1, 16, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 11),
  (1, 17, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 12),
  (1, 18, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 13),
  (1, 19, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 13),
  (1, 20, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 14),
  (2, 1, 'Prepare traffic management and public-safety controls', NULL, NULL, TRUE, NULL, 3),
  (2, 2, 'Set up work zones, detours, signage, and project facilities', NULL, NULL, TRUE, NULL, 6),
  (2, 3, 'Conduct pre-construction meeting', NULL, NULL, TRUE, NULL, 9),
  (3, 1, 'Complete drainage repairs and utility coordination', NULL, NULL, TRUE, NULL, 15),
  (3, 2, 'Complete milling, excavation, subgrade, and base preparation by section', NULL, NULL, TRUE, NULL, 22),
  (3, 3, 'Perform required compaction and quality checks', NULL, NULL, TRUE, NULL, 28),
  (4, 1, 'Complete concrete, asphalt, patching, or resurfacing works by section', NULL, NULL, TRUE, NULL, 38),
  (4, 2, 'Complete shoulders, curbs, sidewalks, markings, and roadside restoration', NULL, NULL, TRUE, NULL, 47),
  (4, 3, 'Conduct staged inspections before opening sections', NULL, NULL, TRUE, NULL, 57),
  (5, 1, 'Complete final quality and safety inspection', NULL, NULL, TRUE, NULL, 59),
  (5, 2, 'Resolve defects and authority findings', NULL, NULL, TRUE, NULL, 61),
  (5, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 64),
  (5, 4, 'Remove temporary controls and turn over the road', NULL, NULL, TRUE, NULL, 66)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'road-maintenance-medium'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;
