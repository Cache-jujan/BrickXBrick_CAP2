-- 047_seed_project_templates.sql
-- Seeds the 15 project templates (catalog v0.2-draft) created by 046.
-- Generated from infra/db/templates/project-templates.json — edit the JSON, not this file,
-- and add a new migration if the catalog changes after this has been applied.
--
-- Structure only: no BOM data, quantities, prices, assignees or progress.
-- Due offsets are ESTIMATES (days after the project's target date of development
-- for Planning items, or of construction for Construction items) and still need
-- validating with the contractor/adviser.
--
-- Safe to re-run: every insert skips rows that already exist.

-- Residential Building — small
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('residential-small', 'Residential Building — small', 'Residential Building', 'small', 'Small residential build such as a bungalow or compact single-family dwelling.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Project Setup and Permit Documents', 'Planning', 21),
  (2, 'Permits and Pre-Construction', 'Planning', 51),
  (3, 'Site Preparation and Foundation', 'Construction', 21),
  (4, 'Structure, Roofing, and Enclosure', 'Construction', 51),
  (5, 'Utilities and Finishes', 'Construction', 79),
  (6, 'Inspection and Turnover', 'Construction', 93)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'residential-small'
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
  (3, 1, 'Set out the building location', NULL, NULL, TRUE, NULL, 5),
  (3, 2, 'Prepare and excavate the site', NULL, NULL, TRUE, NULL, 11),
  (3, 3, 'Complete footing and foundation works', NULL, NULL, TRUE, NULL, 16),
  (3, 4, 'Complete ground-floor slab preparation', NULL, NULL, TRUE, NULL, 21),
  (4, 1, 'Complete structural frame or wall construction', NULL, NULL, TRUE, NULL, 29),
  (4, 2, 'Install roof framing and roofing', NULL, NULL, TRUE, NULL, 36),
  (4, 3, 'Install doors and windows', NULL, NULL, TRUE, NULL, 44),
  (4, 4, 'Complete exterior enclosure', NULL, NULL, TRUE, NULL, 51),
  (5, 1, 'Complete electrical rough-in and fixtures', NULL, NULL, TRUE, NULL, 58),
  (5, 2, 'Complete plumbing and sanitary rough-in and fixtures', NULL, NULL, TRUE, NULL, 65),
  (5, 3, 'Complete wall, ceiling, floor, and paint finishes', NULL, NULL, TRUE, NULL, 72),
  (5, 4, 'Complete external works and site cleanup', NULL, NULL, TRUE, NULL, 79),
  (6, 1, 'Conduct punch-list inspection', NULL, NULL, TRUE, NULL, 81),
  (6, 2, 'Complete corrections', NULL, NULL, TRUE, NULL, 84),
  (6, 3, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 86),
  (6, 4, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 88),
  (6, 5, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 91),
  (6, 6, 'Turn over the completed project to the client', NULL, NULL, TRUE, NULL, 93)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'residential-small'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Residential Building — large
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('residential-large', 'Residential Building — large', 'Residential Building', 'large', 'Large residential build such as a multi-storey house or complex dwelling.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Design, Documentation, and Approvals', 'Planning', 45),
  (2, 'Mobilization and Temporary Facilities', 'Construction', 14),
  (3, 'Earthworks and Foundations', 'Construction', 49),
  (4, 'Structural Frame and Building Envelope', 'Construction', 109),
  (5, 'MEP Rough-In and Interior Works', 'Construction', 154),
  (6, 'External Works and Testing', 'Construction', 184),
  (7, 'Closeout and Occupancy', 'Construction', 205)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'residential-large'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm scope, occupancy, site constraints, and professional team', 'GM', NULL, TRUE, NULL, 2),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 3),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 5),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 6),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 8),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 9),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 11),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 12),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 14),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 15),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 17),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 18),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 20),
  (1, 14, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 21),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 23),
  (1, 16, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 24),
  (1, 17, 'Certified tax declaration and current tax clearance', 'GM', 'COND-TAX-DECLARATION', FALSE, 'When required by the local checklist', 26),
  (1, 18, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 27),
  (1, 19, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 29),
  (1, 20, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 30),
  (1, 21, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 32),
  (1, 22, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 33),
  (1, 23, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 35),
  (1, 24, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 36),
  (1, 25, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 38),
  (1, 26, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 39),
  (1, 27, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 41),
  (1, 28, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 42),
  (1, 29, 'Submit permits and resolve corrections', 'PM', NULL, TRUE, NULL, 44),
  (1, 30, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 45),
  (2, 1, 'Set up site office, storage, safety controls, and project billboard', NULL, NULL, TRUE, NULL, 7),
  (2, 2, 'Conduct pre-construction meeting and site turnover', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete survey and setting out', NULL, NULL, TRUE, NULL, 23),
  (3, 2, 'Complete excavation and earthworks', NULL, NULL, TRUE, NULL, 32),
  (3, 3, 'Complete footings, foundations, waterproofing, and backfill', NULL, NULL, TRUE, NULL, 40),
  (3, 4, 'Complete slabs and underground sleeves', NULL, NULL, TRUE, NULL, 49),
  (4, 1, 'Complete lower-level structural works', NULL, NULL, TRUE, NULL, 64),
  (4, 2, 'Complete upper-level structural works', NULL, NULL, TRUE, NULL, 79),
  (4, 3, 'Complete roof structure and roofing', NULL, NULL, TRUE, NULL, 94),
  (4, 4, 'Complete masonry, windows, doors, and waterproofing', NULL, NULL, TRUE, NULL, 109),
  (5, 1, 'Complete electrical rough-in and panel preparation', NULL, NULL, TRUE, NULL, 120),
  (5, 2, 'Complete plumbing and sanitary rough-in', NULL, NULL, TRUE, NULL, 132),
  (5, 3, 'Complete mechanical or special systems when applicable', NULL, NULL, TRUE, NULL, 143),
  (5, 4, 'Complete ceilings, partitions, floors, cabinets, and finishes', NULL, NULL, TRUE, NULL, 154),
  (6, 1, 'Complete drainage and utility connections', NULL, NULL, TRUE, NULL, 162),
  (6, 2, 'Complete driveway, fence, landscaping, and external works', NULL, NULL, TRUE, NULL, 169),
  (6, 3, 'Test electrical, plumbing, sanitary, and other installed systems', NULL, NULL, TRUE, NULL, 177),
  (6, 4, 'Resolve inspection findings', NULL, NULL, TRUE, NULL, 184),
  (7, 1, 'Complete final inspections', NULL, NULL, TRUE, NULL, 188),
  (7, 2, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 192),
  (7, 3, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 197),
  (7, 4, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 201),
  (7, 5, 'Complete final punch list and client turnover', NULL, NULL, TRUE, NULL, 205)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'residential-large'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Commercial Building — small
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('commercial-small', 'Commercial Building — small', 'Commercial Building', 'small', 'Small commercial building or low-complexity business premises.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Commercial Scope and Permits', 'Planning', 30),
  (2, 'Site Preparation and Structure', 'Construction', 28),
  (3, 'Utilities and Commercial Fit-Out', 'Construction', 56),
  (4, 'Testing, Inspection, and Turnover', 'Construction', 70)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'commercial-small'
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
  (2, 1, 'Turn over and secure the site', NULL, NULL, TRUE, NULL, 9),
  (2, 2, 'Complete setting out, excavation, and foundations', NULL, NULL, TRUE, NULL, 19),
  (2, 3, 'Complete structural works and building enclosure', NULL, NULL, TRUE, NULL, 28),
  (3, 1, 'Complete electrical, sanitary, and plumbing works', NULL, NULL, TRUE, NULL, 37),
  (3, 2, 'Install required fire-safety provisions', NULL, NULL, TRUE, NULL, 47),
  (3, 3, 'Complete interior finishes and external access works', NULL, NULL, TRUE, NULL, 56),
  (4, 1, 'Test installed systems', NULL, NULL, TRUE, NULL, 58),
  (4, 2, 'Complete punch-list corrections', NULL, NULL, TRUE, NULL, 61),
  (4, 3, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 63),
  (4, 4, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 65),
  (4, 5, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 68),
  (4, 6, 'Turn over the premises', NULL, NULL, TRUE, NULL, 70)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'commercial-small'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Commercial Building — large
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('commercial-large', 'Commercial Building — large', 'Commercial Building', 'large', 'Large or multi-level commercial building with more complex coordination and inspections.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Design, Fire Safety, and Permit Approvals', 'Planning', 60),
  (2, 'Mobilization and Site Works', 'Construction', 45),
  (3, 'Structure and Building Envelope', 'Construction', 120),
  (4, 'MEP, Fire Protection, and Interior Works', 'Construction', 180),
  (5, 'Systems Testing and Regulatory Inspection', 'Construction', 210),
  (6, 'Occupancy and Handover', 'Construction', 231)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'commercial-large'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm occupancy classification and commercial requirements', 'GM', NULL, TRUE, NULL, 2),
  (1, 2, 'Coordinate mechanical, electronics, and fire-safety documents as applicable', 'PM', NULL, TRUE, NULL, 4),
  (1, 3, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 6),
  (1, 4, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 8),
  (1, 5, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 9),
  (1, 6, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 11),
  (1, 7, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 13),
  (1, 8, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 15),
  (1, 9, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 17),
  (1, 10, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 19),
  (1, 11, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 21),
  (1, 12, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 23),
  (1, 13, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 24),
  (1, 14, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 26),
  (1, 15, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 28),
  (1, 16, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 30),
  (1, 17, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 32),
  (1, 18, 'Certified tax declaration and current tax clearance', 'GM', 'COND-TAX-DECLARATION', FALSE, 'When required by the local checklist', 34),
  (1, 19, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 36),
  (1, 20, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 38),
  (1, 21, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 39),
  (1, 22, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 41),
  (1, 23, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 43),
  (1, 24, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 45),
  (1, 25, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 47),
  (1, 26, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 49),
  (1, 27, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 51),
  (1, 28, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 53),
  (1, 29, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 54),
  (1, 30, 'Sign permit', 'PM', 'COND-SIGN', FALSE, 'When a regulated project sign or permanent sign is installed', 56),
  (1, 31, 'Submit permits and close all correction items', 'PM', NULL, TRUE, NULL, 58),
  (1, 32, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 60),
  (2, 1, 'Set up site facilities, safety controls, and project billboard', NULL, NULL, TRUE, NULL, 23),
  (2, 2, 'Complete survey, earthworks, excavation, and foundations', NULL, NULL, TRUE, NULL, 45),
  (3, 1, 'Complete structural frame by level or zone', NULL, NULL, TRUE, NULL, 70),
  (3, 2, 'Complete roof and waterproofing', NULL, NULL, TRUE, NULL, 95),
  (3, 3, 'Complete walls, windows, doors, and external envelope', NULL, NULL, TRUE, NULL, 120),
  (4, 1, 'Complete electrical and communications rough-in', NULL, NULL, TRUE, NULL, 135),
  (4, 2, 'Complete plumbing and sanitary systems', NULL, NULL, TRUE, NULL, 150),
  (4, 3, 'Complete mechanical and fire-protection systems when applicable', NULL, NULL, TRUE, NULL, 165),
  (4, 4, 'Complete partitions, ceilings, floors, and finishes', NULL, NULL, TRUE, NULL, 180),
  (5, 1, 'Test and commission installed systems', NULL, NULL, TRUE, NULL, 190),
  (5, 2, 'Conduct fire-safety inspection preparation', NULL, NULL, TRUE, NULL, 200),
  (5, 3, 'Resolve technical and regulatory deficiencies', NULL, NULL, TRUE, NULL, 210),
  (6, 1, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 214),
  (6, 2, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 217),
  (6, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 221),
  (6, 4, 'Complete final punch list', NULL, NULL, TRUE, NULL, 224),
  (6, 5, 'Deliver operations, warranty, and closeout records', NULL, NULL, TRUE, NULL, 228),
  (6, 6, 'Turn over the completed commercial building', NULL, NULL, TRUE, NULL, 231)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'commercial-large'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Fit-out / Renovation — small
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('fitout-renovation-small', 'Fit-out / Renovation — small', 'Fit-out / Renovation', 'small', 'Small interior renovation or fit-out with limited structural intervention.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Existing Condition and Permit Review', 'Planning', 21),
  (2, 'Site Preparation', 'Construction', 14),
  (3, 'Fit-Out and Installation', 'Construction', 42),
  (4, 'Testing and Turnover', 'Construction', 56)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'fitout-renovation-small'
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
  (2, 1, 'Protect occupied or adjacent areas', NULL, NULL, TRUE, NULL, 7),
  (2, 2, 'Complete approved demolition or removal works when applicable', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete partitions, ceilings, floors, and finishes', NULL, NULL, TRUE, NULL, 23),
  (3, 2, 'Complete electrical, plumbing, sanitary, and equipment connections', NULL, NULL, TRUE, NULL, 33),
  (3, 3, 'Complete fixtures, doors, and built-in works', NULL, NULL, TRUE, NULL, 42),
  (4, 1, 'Test installed systems', NULL, NULL, TRUE, NULL, 45),
  (4, 2, 'Complete punch-list corrections', NULL, NULL, TRUE, NULL, 48),
  (4, 3, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 50),
  (4, 4, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 53),
  (4, 5, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 56)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'fitout-renovation-small'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Fit-out / Renovation — large
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('fitout-renovation-large', 'Fit-out / Renovation — large', 'Fit-out / Renovation', 'large', 'Large renovation, major fit-out, or alteration with multiple work zones and systems.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Survey, Design, and Approvals', 'Planning', 45),
  (2, 'Phased Mobilization and Protection', 'Construction', 14),
  (3, 'Demolition and Structural Alterations', 'Construction', 49),
  (4, 'Building Systems and Fit-Out', 'Construction', 94),
  (5, 'Testing, Corrections, and Closeout', 'Construction', 122)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'fitout-renovation-large'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Complete existing-condition survey and record review', 'PM', NULL, TRUE, NULL, 2),
  (1, 2, 'Confirm structural, occupancy, fire, and utility constraints', 'PM', NULL, TRUE, NULL, 4),
  (1, 3, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 5),
  (1, 4, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 7),
  (1, 5, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 9),
  (1, 6, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 11),
  (1, 7, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 13),
  (1, 8, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 14),
  (1, 9, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 16),
  (1, 10, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 18),
  (1, 11, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 20),
  (1, 12, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 22),
  (1, 13, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 23),
  (1, 14, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 25),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 27),
  (1, 16, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 29),
  (1, 17, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 31),
  (1, 18, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 32),
  (1, 19, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 34),
  (1, 20, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 36),
  (1, 21, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 38),
  (1, 22, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 40),
  (1, 23, 'Sign permit', 'PM', 'COND-SIGN', FALSE, 'When a regulated project sign or permanent sign is installed', 41),
  (1, 24, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 43),
  (1, 25, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 45),
  (2, 1, 'Prepare phased work zones and access controls', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Set up safety, dust, noise, and temporary-utility controls', NULL, NULL, TRUE, NULL, 9),
  (2, 3, 'Conduct pre-work inspection and client turnover of work areas', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete approved demolition by zone', NULL, NULL, TRUE, NULL, 26),
  (3, 2, 'Complete structural strengthening or alterations when applicable', NULL, NULL, TRUE, NULL, 37),
  (3, 3, 'Complete disposal, protection, and inspection of exposed conditions', NULL, NULL, TRUE, NULL, 49),
  (4, 1, 'Complete electrical and communications works', NULL, NULL, TRUE, NULL, 64),
  (4, 2, 'Complete plumbing, sanitary, mechanical, and fire-safety works', NULL, NULL, TRUE, NULL, 79),
  (4, 3, 'Complete partitions, ceilings, floors, finishes, and fixtures by zone', NULL, NULL, TRUE, NULL, 94),
  (5, 1, 'Test and commission all affected systems', NULL, NULL, TRUE, NULL, 99),
  (5, 2, 'Complete authority and client inspections', NULL, NULL, TRUE, NULL, 103),
  (5, 3, 'Resolve punch-list and compliance findings', NULL, NULL, TRUE, NULL, 108),
  (5, 4, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 113),
  (5, 5, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 117),
  (5, 6, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 122)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'fitout-renovation-large'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Civil Works — small
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('civil-works-small', 'Civil Works — small', 'Civil Works', 'small', 'Small civil works such as minor site development, concrete works, or public-area improvements.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Survey, Design, and Clearances', 'Planning', 21),
  (2, 'Mobilization and Ground Preparation', 'Construction', 14),
  (3, 'Civil Construction', 'Construction', 42),
  (4, 'Inspection and Handover', 'Construction', 56)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'civil-works-small'
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
  (2, 1, 'Set up safety controls and work boundaries', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Complete survey and setting out', NULL, NULL, TRUE, NULL, 9),
  (2, 3, 'Complete clearing, excavation, and subgrade preparation', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete forms, reinforcement, drainage, or concrete works as applicable', NULL, NULL, TRUE, NULL, 23),
  (3, 2, 'Complete curing and quality checks', NULL, NULL, TRUE, NULL, 33),
  (3, 3, 'Complete surface restoration and cleanup', NULL, NULL, TRUE, NULL, 42),
  (4, 1, 'Complete testing and inspection', NULL, NULL, TRUE, NULL, 46),
  (4, 2, 'Resolve defects', NULL, NULL, TRUE, NULL, 49),
  (4, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 53),
  (4, 4, 'Hand over the site', NULL, NULL, TRUE, NULL, 56)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'civil-works-small'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Civil Works — large
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('civil-works-large', 'Civil Works — large', 'Civil Works', 'large', 'Large civil works with multiple zones, interfaces, or authority clearances.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Engineering, Survey, and Authority Approvals', 'Planning', 45),
  (2, 'Mobilization and Temporary Works', 'Construction', 21),
  (3, 'Earthworks and Substructure', 'Construction', 66),
  (4, 'Main Civil Works', 'Construction', 126),
  (5, 'Restoration, Inspection, and Handover', 'Construction', 147)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'civil-works-large'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm alignment, right-of-way, site limits, and work zones', 'PM', NULL, TRUE, NULL, 2),
  (1, 2, 'Complete site survey', 'PM', NULL, TRUE, NULL, 3),
  (1, 3, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 5),
  (1, 4, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 6),
  (1, 5, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 8),
  (1, 6, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 10),
  (1, 7, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 11),
  (1, 8, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 13),
  (1, 9, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 14),
  (1, 10, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 16),
  (1, 11, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 18),
  (1, 12, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 19),
  (1, 13, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 21),
  (1, 14, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 23),
  (1, 15, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 24),
  (1, 16, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 26),
  (1, 17, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 27),
  (1, 18, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 29),
  (1, 19, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 31),
  (1, 20, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 32),
  (1, 21, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 34),
  (1, 22, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 35),
  (1, 23, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 37),
  (1, 24, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 39),
  (1, 25, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 40),
  (1, 26, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 42),
  (1, 27, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 43),
  (1, 28, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 45),
  (2, 1, 'Set up site facilities, safety controls, traffic controls, and project billboard', NULL, NULL, TRUE, NULL, 7),
  (2, 2, 'Establish benchmarks, access, drainage protection, and temporary works', NULL, NULL, TRUE, NULL, 14),
  (2, 3, 'Conduct pre-construction meeting', NULL, NULL, TRUE, NULL, 21),
  (3, 1, 'Complete clearing, demolition, excavation, and disposal', NULL, NULL, TRUE, NULL, 36),
  (3, 2, 'Complete subgrade, embankment, backfill, and compaction', NULL, NULL, TRUE, NULL, 51),
  (3, 3, 'Complete foundations, drainage, and underground works', NULL, NULL, TRUE, NULL, 66),
  (4, 1, 'Complete structural or concrete works by zone', NULL, NULL, TRUE, NULL, 86),
  (4, 2, 'Complete utilities, drainage, curbs, pavement, or site structures', NULL, NULL, TRUE, NULL, 106),
  (4, 3, 'Perform quality checks and required tests', NULL, NULL, TRUE, NULL, 126),
  (5, 1, 'Complete surface restoration and environmental controls', NULL, NULL, TRUE, NULL, 131),
  (5, 2, 'Resolve authority and client inspection findings', NULL, NULL, TRUE, NULL, 137),
  (5, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 142),
  (5, 4, 'Turn over the completed civil works', NULL, NULL, TRUE, NULL, 147)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'civil-works-large'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Structural Retrofitting — small
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('structural-retrofitting-small', 'Structural Retrofitting — small', 'Structural Retrofitting', 'small', 'Small structural repair or strengthening project with limited intervention.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Assessment, Design, and Approval', 'Planning', 28),
  (2, 'Protection and Preparation', 'Construction', 14),
  (3, 'Retrofitting Works', 'Construction', 42),
  (4, 'Testing and Closeout', 'Construction', 56)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'structural-retrofitting-small'
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
  (2, 1, 'Isolate the work area and protect occupants', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Install temporary supports when required', NULL, NULL, TRUE, NULL, 9),
  (2, 3, 'Prepare surfaces and expose repair locations', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete approved repair or strengthening works', NULL, NULL, TRUE, NULL, 23),
  (3, 2, 'Complete connection, reinforcement, or concrete works', NULL, NULL, TRUE, NULL, 33),
  (3, 3, 'Conduct required inspections and quality checks', NULL, NULL, TRUE, NULL, 42),
  (4, 1, 'Remove temporary supports after approval', NULL, NULL, TRUE, NULL, 44),
  (4, 2, 'Complete finishing and restoration', NULL, NULL, TRUE, NULL, 47),
  (4, 3, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 49),
  (4, 4, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 51),
  (4, 5, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 54),
  (4, 6, 'Complete client and authority handover', NULL, NULL, TRUE, NULL, 56)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'structural-retrofitting-small'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Structural Retrofitting — large
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('structural-retrofitting-large', 'Structural Retrofitting — large', 'Structural Retrofitting', 'large', 'Large or phased strengthening project involving multiple structural zones or systems.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Condition Assessment and Engineering Design', 'Planning', 60),
  (2, 'Phased Mobilization and Temporary Works', 'Construction', 21),
  (3, 'Structural Strengthening by Zone', 'Construction', 81),
  (4, 'Restoration and Systems Coordination', 'Construction', 111),
  (5, 'Final Inspection and Handover', 'Construction', 132)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'structural-retrofitting-large'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Complete detailed structural assessment and documentation', 'PM', NULL, TRUE, NULL, 2),
  (1, 2, 'Confirm occupancy, access, and temporary-support constraints', 'PM', NULL, TRUE, NULL, 5),
  (1, 3, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 7),
  (1, 4, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 10),
  (1, 5, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 12),
  (1, 6, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 14),
  (1, 7, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 17),
  (1, 8, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 19),
  (1, 9, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 22),
  (1, 10, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 24),
  (1, 11, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 26),
  (1, 12, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 29),
  (1, 13, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 31),
  (1, 14, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 34),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 36),
  (1, 16, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 38),
  (1, 17, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 41),
  (1, 18, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 43),
  (1, 19, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 46),
  (1, 20, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 48),
  (1, 21, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 50),
  (1, 22, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 53),
  (1, 23, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 55),
  (1, 24, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 58),
  (1, 25, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 60),
  (2, 1, 'Prepare work zones and occupant protection', NULL, NULL, TRUE, NULL, 7),
  (2, 2, 'Install temporary supports and monitoring points', NULL, NULL, TRUE, NULL, 14),
  (2, 3, 'Conduct pre-work inspection and approve the phase sequence', NULL, NULL, TRUE, NULL, 21),
  (3, 1, 'Complete demolition and exposure works by zone', NULL, NULL, TRUE, NULL, 41),
  (3, 2, 'Complete strengthening, repair, and connection works', NULL, NULL, TRUE, NULL, 61),
  (3, 3, 'Perform inspections and tests before closing each zone', NULL, NULL, TRUE, NULL, 81),
  (4, 1, 'Restore affected architectural finishes', NULL, NULL, TRUE, NULL, 91),
  (4, 2, 'Reinstate electrical, plumbing, sanitary, and fire-safety systems', NULL, NULL, TRUE, NULL, 101),
  (4, 3, 'Remove temporary works after engineer approval', NULL, NULL, TRUE, NULL, 111),
  (5, 1, 'Complete final structural inspection and documentation', NULL, NULL, TRUE, NULL, 115),
  (5, 2, 'Resolve punch-list and authority findings', NULL, NULL, TRUE, NULL, 118),
  (5, 3, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 122),
  (5, 4, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 125),
  (5, 5, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 129),
  (5, 6, 'Turn over the retrofitted structure', NULL, NULL, TRUE, NULL, 132)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'structural-retrofitting-large'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Drainage / Flood Control — small
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('drainage-flood-control-small', 'Drainage / Flood Control — small', 'Drainage / Flood Control', 'small', 'Small drainage improvement, canal repair, culvert work, or localized flood-control project.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Survey, Hydrology, and Clearances', 'Planning', 28),
  (2, 'Site Preparation and Temporary Flow Control', 'Construction', 14),
  (3, 'Drainage Construction', 'Construction', 42),
  (4, 'Handover and Maintenance Records', 'Construction', 56)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'drainage-flood-control-small'
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
  (2, 1, 'Set up safety, traffic, and pedestrian controls', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Provide temporary diversion or dewatering when required', NULL, NULL, TRUE, NULL, 9),
  (2, 3, 'Complete clearing and excavation', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete canal, culvert, inlet, outlet, or repair works', NULL, NULL, TRUE, NULL, 23),
  (3, 2, 'Complete backfill, protection, and surface restoration', NULL, NULL, TRUE, NULL, 33),
  (3, 3, 'Test flow and inspect completed works', NULL, NULL, TRUE, NULL, 42),
  (4, 1, 'Resolve defects and restore affected areas', NULL, NULL, TRUE, NULL, 47),
  (4, 2, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 51),
  (4, 3, 'Turn over drainage works and maintenance information', NULL, NULL, TRUE, NULL, 56)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'drainage-flood-control-small'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Drainage / Flood Control — large
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('drainage-flood-control-large', 'Drainage / Flood Control — large', 'Drainage / Flood Control', 'large', 'Large drainage or flood-control project covering multiple zones, channels, or structures.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Engineering, Survey, and Environmental Approvals', 'Planning', 60),
  (2, 'Mobilization and Temporary Water Management', 'Construction', 21),
  (3, 'Earthworks and Main Drainage Structures', 'Construction', 81),
  (4, 'Testing, Restoration, and Environmental Compliance', 'Construction', 111),
  (5, 'As-Built and Handover', 'Construction', 125)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'drainage-flood-control-large'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Complete topographic, drainage, and hydrologic assessment', 'PM', NULL, TRUE, NULL, 2),
  (1, 2, 'Confirm affected properties, easements, right-of-way, and work zones', 'PM', NULL, TRUE, NULL, 4),
  (1, 3, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 7),
  (1, 4, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 9),
  (1, 5, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 11),
  (1, 6, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 13),
  (1, 7, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 16),
  (1, 8, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 18),
  (1, 9, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 20),
  (1, 10, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 22),
  (1, 11, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 24),
  (1, 12, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 27),
  (1, 13, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 29),
  (1, 14, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 31),
  (1, 15, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 33),
  (1, 16, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 36),
  (1, 17, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 38),
  (1, 18, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 40),
  (1, 19, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 42),
  (1, 20, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 44),
  (1, 21, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 47),
  (1, 22, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 49),
  (1, 23, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 51),
  (1, 24, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 53),
  (1, 25, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 56),
  (1, 26, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 58),
  (1, 27, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 60),
  (2, 1, 'Set up safety, traffic, environmental, and community controls', NULL, NULL, TRUE, NULL, 7),
  (2, 2, 'Install temporary diversion, bypass, dewatering, or protection works', NULL, NULL, TRUE, NULL, 14),
  (2, 3, 'Conduct pre-construction meeting and establish inspection points', NULL, NULL, TRUE, NULL, 21),
  (3, 1, 'Complete clearing, excavation, and foundation preparation by zone', NULL, NULL, TRUE, NULL, 41),
  (3, 2, 'Construct canals, culverts, outfalls, retaining structures, or flood-control works', NULL, NULL, TRUE, NULL, 61),
  (3, 3, 'Complete backfill, embankment, erosion protection, and utility interfaces', NULL, NULL, TRUE, NULL, 81),
  (4, 1, 'Test flow capacity and inspect structures', NULL, NULL, TRUE, NULL, 89),
  (4, 2, 'Restore roads, sidewalks, properties, and affected utilities', NULL, NULL, TRUE, NULL, 96),
  (4, 3, 'Complete environmental and safety closeout actions', NULL, NULL, TRUE, NULL, 104),
  (4, 4, 'Resolve inspection findings', NULL, NULL, TRUE, NULL, 111),
  (5, 1, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 116),
  (5, 2, 'Document maintenance and operating requirements', NULL, NULL, TRUE, NULL, 120),
  (5, 3, 'Complete final inspection and turn over the system', NULL, NULL, TRUE, NULL, 125)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'drainage-flood-control-large'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Road Maintenance — small
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('road-maintenance-small', 'Road Maintenance — small', 'Road Maintenance', 'small', 'Small road repair, patching, resurfacing, shoulder, or localized pavement maintenance project.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Survey, Traffic Plan, and Clearances', 'Planning', 14),
  (2, 'Traffic Control and Preparation', 'Construction', 7),
  (3, 'Road Repair and Restoration', 'Construction', 21),
  (4, 'Inspection and Opening', 'Construction', 28)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'road-maintenance-small'
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
  (2, 1, 'Install traffic and pedestrian controls', NULL, NULL, TRUE, NULL, 2),
  (2, 2, 'Complete marking, removal, milling, or surface preparation', NULL, NULL, TRUE, NULL, 5),
  (2, 3, 'Prepare drainage and subgrade interfaces', NULL, NULL, TRUE, NULL, 7),
  (3, 1, 'Complete base, concrete, asphalt, patching, or shoulder works', NULL, NULL, TRUE, NULL, 12),
  (3, 2, 'Complete curing or compaction checks', NULL, NULL, TRUE, NULL, 16),
  (3, 3, 'Restore markings, edges, drainage, and affected areas', NULL, NULL, TRUE, NULL, 21),
  (4, 1, 'Conduct final surface and safety inspection', NULL, NULL, TRUE, NULL, 23),
  (4, 2, 'Resolve defects', NULL, NULL, TRUE, NULL, 25),
  (4, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 26),
  (4, 4, 'Remove temporary controls and reopen the road', NULL, NULL, TRUE, NULL, 28)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'road-maintenance-small'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Road Maintenance — large
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('road-maintenance-large', 'Road Maintenance — large', 'Road Maintenance', 'large', 'Large or phased road maintenance project involving multiple sections, traffic stages, or drainage interfaces.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Condition Survey, Engineering, and Approvals', 'Planning', 45),
  (2, 'Traffic Management and Mobilization', 'Construction', 14),
  (3, 'Drainage, Subgrade, and Base Works', 'Construction', 44),
  (4, 'Pavement and Roadside Works', 'Construction', 89),
  (5, 'Final Inspection and Handover', 'Construction', 103)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'road-maintenance-large'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Complete pavement, drainage, traffic, and right-of-way survey', 'PM', NULL, TRUE, NULL, 2),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 4),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 5),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 7),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 9),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 11),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 13),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 14),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 16),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 18),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 20),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 22),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 23),
  (1, 14, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 25),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 27),
  (1, 16, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 29),
  (1, 17, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 31),
  (1, 18, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 32),
  (1, 19, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 34),
  (1, 20, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 36),
  (1, 21, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 38),
  (1, 22, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 40),
  (1, 23, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 41),
  (1, 24, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 43),
  (1, 25, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 45),
  (2, 1, 'Prepare traffic management and public-safety controls', NULL, NULL, TRUE, NULL, 5),
  (2, 2, 'Set up work zones, detours, signage, and project facilities', NULL, NULL, TRUE, NULL, 9),
  (2, 3, 'Conduct pre-construction meeting', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Complete drainage repairs and utility coordination', NULL, NULL, TRUE, NULL, 24),
  (3, 2, 'Complete milling, excavation, subgrade, and base preparation by section', NULL, NULL, TRUE, NULL, 34),
  (3, 3, 'Perform required compaction and quality checks', NULL, NULL, TRUE, NULL, 44),
  (4, 1, 'Complete concrete, asphalt, patching, or resurfacing works by section', NULL, NULL, TRUE, NULL, 59),
  (4, 2, 'Complete shoulders, curbs, sidewalks, markings, and roadside restoration', NULL, NULL, TRUE, NULL, 74),
  (4, 3, 'Conduct staged inspections before opening sections', NULL, NULL, TRUE, NULL, 89),
  (5, 1, 'Complete final quality and safety inspection', NULL, NULL, TRUE, NULL, 93),
  (5, 2, 'Resolve defects and authority findings', NULL, NULL, TRUE, NULL, 96),
  (5, 3, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 100),
  (5, 4, 'Remove temporary controls and turn over the road', NULL, NULL, TRUE, NULL, 103)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'road-maintenance-large'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;

-- Other / custom project
INSERT INTO project_templates (templateKey, name, projectType, size, description, version)
VALUES ('other-custom', 'Other / custom project', 'Other', 'custom', 'Blank structure for projects that do not fit the standard categories.', '0.2')
ON CONFLICT (templateKey) DO NOTHING;

INSERT INTO project_template_milestones (templateId, sequence, name, phase, dueOffsetDays)
SELECT t.templateId, v.sequence, v.name, v.phase, v.dueOffsetDays
  FROM project_templates t,
       (VALUES
  (1, 'Project Setup, Design, and Permits', 'Planning', 28),
  (2, 'Mobilization and Preparation', 'Construction', 14),
  (3, 'Main Execution Works', 'Construction', 42),
  (4, 'Closeout and Handover', 'Construction', 56)
       ) AS v(sequence, name, phase, dueOffsetDays)
 WHERE t.templateKey = 'other-custom'
ON CONFLICT (templateId, sequence) DO NOTHING;

INSERT INTO project_template_tasks
  (templateMilestoneId, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
SELECT m.templateMilestoneId, v.sequence, v.name, v.handledBy, v.requirementCode, v.defaultIncluded, v.hint, v.dueOffsetDays
  FROM project_templates t
  JOIN project_template_milestones m ON m.templateId = t.templateId
  JOIN (VALUES
  (1, 1, 'Confirm scope, site, client, professional team, and applicable permits', 'GM', NULL, TRUE, NULL, 1),
  (1, 2, 'Unified Application Form for Building Permit', 'PM', 'BP-UAF', TRUE, NULL, 2),
  (1, 3, 'Architectural permit/plans', 'PM', 'BP-ARCH', TRUE, NULL, 3),
  (1, 4, 'Civil/structural permit or structural plans', 'PM', 'BP-STRUCT', TRUE, NULL, 4),
  (1, 5, 'Electrical permit', 'PM', 'BP-ELEC', TRUE, NULL, 5),
  (1, 6, 'Sanitary permit', 'PM', 'BP-SAN', TRUE, NULL, 5),
  (1, 7, 'Plumbing permit', 'PM', 'BP-PLUMB', TRUE, NULL, 6),
  (1, 8, 'Certificate of supervising architect/engineer', 'PM', 'BP-SUPERVISOR', TRUE, NULL, 7),
  (1, 9, 'Bill of Materials', 'GM', 'BP-BOM', TRUE, 'Tracks the BOM as a task only. The project BOM stays a separate client-signed record and is not created or filled by this task.', 8),
  (1, 10, 'Construction specifications', 'PM', 'BP-SPECS', TRUE, NULL, 9),
  (1, 11, 'Structural design analysis (when applicable)', 'PM', 'BP-STRUCT-ANALYSIS', TRUE, 'Applicable when the structure requires a design analysis. Uncheck if it does not.', 10),
  (1, 12, 'Signed and sealed plans from the responsible professionals', 'PM', 'BP-SIGNED-SEALED', TRUE, NULL, 11),
  (1, 13, 'Professional licenses and PTR copies', 'PM', 'BP-PTR-PRC', TRUE, NULL, 12),
  (1, 14, 'Location or zoning clearance', 'PM', 'COND-LOCATION', FALSE, 'When required by the city or municipality', 13),
  (1, 15, 'Barangay clearance', 'PM', 'COND-BARANGAY', FALSE, 'When required by the local checklist', 14),
  (1, 16, 'Certified true copy of title, deed of sale, or lease contract', 'GM', 'COND-TITLE', FALSE, 'Depending on ownership or authority to build', 14),
  (1, 17, 'Certified tax declaration and current tax clearance', 'GM', 'COND-TAX-DECLARATION', FALSE, 'When required by the local checklist', 15),
  (1, 18, 'Geodetic survey or sketch plan', 'PM', 'COND-GEODETIC', FALSE, 'When required by the scope or local checklist', 16),
  (1, 19, 'Authorization letter, SPA, or secretary''s certificate', 'GM', 'COND-AUTHORITY', FALSE, 'When the filer is not the owner or the owner is a corporation', 17),
  (1, 20, 'Fire Safety Evaluation Clearance', 'PM', 'COND-FSEC', FALSE, 'When required by BFP and project classification', 18),
  (1, 21, 'Construction Safety and Health Program', 'PM', 'COND-DOLE-CSHP', FALSE, 'When required by project size, workforce, or DOLE rules', 19),
  (1, 22, 'DPWH clearance', 'PM', 'COND-DPWH', FALSE, 'When the site or work is along a national highway or affects DPWH property', 20),
  (1, 23, 'DENR ECC/CNC or other environmental clearance', 'PM', 'COND-DENR', FALSE, 'When required by the project location, scope, or environmental rules', 21),
  (1, 24, 'Fencing permit', 'PM', 'COND-FENCE', FALSE, 'When a new or modified perimeter fence is included', 22),
  (1, 25, 'Excavation and ground preparation permit', 'PM', 'COND-EXCAVATION', FALSE, 'When excavation or ground preparation requires a separate permit', 23),
  (1, 26, 'Demolition permit', 'PM', 'COND-DEMOLITION', FALSE, 'When demolition is part of the work', 23),
  (1, 27, 'Temporary service connection permit', 'PM', 'COND-TEMP-UTILITY', FALSE, 'When temporary electrical or water service is needed', 24),
  (1, 28, 'Sidewalk, sidewalk enclosure, or temporary occupancy permit', 'PM', 'COND-SIDEWALK', FALSE, 'When public sidewalk or road space is occupied', 25),
  (1, 29, 'Sign permit', 'PM', 'COND-SIGN', FALSE, 'When a regulated project sign or permanent sign is installed', 26),
  (1, 30, 'Submit permit applications and resolve corrections', 'PM', NULL, TRUE, NULL, 27),
  (1, 31, 'Receive approved permits', 'PM', NULL, TRUE, NULL, 28),
  (2, 1, 'Complete site turnover, safety orientation, access, and temporary works', NULL, NULL, TRUE, NULL, 7),
  (2, 2, 'Complete survey and preparation works', NULL, NULL, TRUE, NULL, 14),
  (3, 1, 'Add project-specific execution tasks', NULL, NULL, TRUE, NULL, 28),
  (3, 2, 'Complete inspections and quality checks', NULL, NULL, TRUE, NULL, 42),
  (4, 1, 'Complete punch list and corrections', NULL, NULL, TRUE, NULL, 45),
  (4, 2, 'Certificate of Occupancy and related completion documents', NULL, 'COND-OCCUPANCY', FALSE, 'When the completed structure will be occupied or used', 48),
  (4, 3, 'Fire Safety Inspection Certificate', NULL, 'COND-FSIC', FALSE, 'When required before occupancy or permit release', 50),
  (4, 4, 'As-built plans, construction logbook, and completed-structure photos', NULL, 'COND-AS-BUILT', FALSE, 'As applicable, especially when work differs from approved plans', 53),
  (4, 5, 'Turn over the completed project', NULL, NULL, TRUE, NULL, 56)
       ) AS v(milestoneSequence, sequence, name, handledBy, requirementCode, defaultIncluded, hint, dueOffsetDays)
    ON v.milestoneSequence = m.sequence
 WHERE t.templateKey = 'other-custom'
ON CONFLICT (templateMilestoneId, sequence) DO NOTHING;
