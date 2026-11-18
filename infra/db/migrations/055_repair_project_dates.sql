-- 055_repair_project_dates.sql
--
-- Migration 026 added the project date-order rules as CHECK constraints marked
-- NOT VALID, so rows saved before it were never checked. Together with the new
-- lock on the target dates of development and construction, every project now
-- has to follow the order:
--
--     startDate (development)  <=  constructionStartDate  <=  endDate (completion)
--
-- 1. A construction start before the development date is moved up to the
--    development date.
-- 2. A completion date before construction starts (or before development, when
--    no construction date is set) is moved up to that date.
-- 3. Both constraints are then validated, so they cover every row and not only
--    new writes.
--
-- Steps 1 and 2 are ONE statement on purpose. Postgres checks the NOT VALID
-- constraints on every row it updates, so a row that is wrong in both ways
-- (e.g. construction before development AND completion before construction)
-- can't be fixed one date at a time: the first fix would trip the other rule.
-- Fixing both together computes the repaired construction date first and
-- measures the completion date against it.
--
-- GREATEST() ignores NULLs, so the NULL cases are guarded with CASE.
-- Safe to run more than once: after the first run no row matches the WHERE.

UPDATE projects
   SET constructionStartDate = CASE
         WHEN constructionStartDate IS NULL THEN NULL
         ELSE GREATEST(constructionStartDate, startDate)
       END,
       endDate = CASE
         WHEN endDate IS NULL THEN NULL
         ELSE GREATEST(
                endDate,
                CASE
                  WHEN constructionStartDate IS NULL THEN startDate
                  ELSE GREATEST(constructionStartDate, startDate)
                END
              )
       END
 WHERE (constructionStartDate IS NOT NULL AND constructionStartDate < startDate)
    OR (endDate IS NOT NULL AND endDate < COALESCE(constructionStartDate, startDate));

ALTER TABLE projects VALIDATE CONSTRAINT projects_construction_after_development_check;
ALTER TABLE projects VALIDATE CONSTRAINT projects_completion_after_construction_check;
