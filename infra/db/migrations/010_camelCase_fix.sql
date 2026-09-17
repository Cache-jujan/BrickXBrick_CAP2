CREATE SCHEMA "public";
CREATE TABLE "blockchainlogs" (
	"logid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expenseid" uuid NOT NULL,
	"actorid" uuid NOT NULL,
	"txhash" varchar(100) NOT NULL CONSTRAINT "blockchainlogs_txhash_key" UNIQUE,
	"blocknumber" integer NOT NULL,
	"eventtype" varchar(50) NOT NULL,
	"validatornodecount" integer NOT NULL,
	"consensustype" varchar(30) DEFAULT 'Clique' NOT NULL,
	"timestamp" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "blockchainlogs_eventtype_check" CHECK (((eventtype)::text = ANY ((ARRAY['ExpenseApproved'::character varying, 'ReportGenerated'::character varying, 'SyncCompleted'::character varying])::text[]))),
	CONSTRAINT "blockchainlogs_validatornodecount_check" CHECK (((validatornodecount >= 2) AND (validatornodecount <= 3)))
);
CREATE TABLE "expenses" (
	"expenseid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"projectid" uuid NOT NULL,
	"submittedby" uuid NOT NULL,
	"approvedby" uuid,
	"ticketid" uuid,
	"vendorname" varchar(200) NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"receiptdate" date NOT NULL,
	"category" varchar(50) NOT NULL,
	"birvalidationstatus" varchar(30) NOT NULL,
	"receiptimageurl" text NOT NULL,
	"status" varchar(30) DEFAULT 'Pending' NOT NULL,
	"submittedat" timestamp DEFAULT now() NOT NULL,
	"birnumber" varchar(20),
	"quantity" numeric(10, 2) NOT NULL,
	"tin" varchar(20),
	"birpermitnumber" varchar(20),
	"lineitems" jsonb,
	"blockchainstatus" varchar(20) DEFAULT 'None' NOT NULL,
	CONSTRAINT "expenses_amount_check" CHECK ((amount >= (0)::numeric)),
	CONSTRAINT "expenses_birvalidationstatus_check" CHECK (((birvalidationstatus)::text = ANY (ARRAY[('Formal-Tax-Deductible'::character varying)::text, ('Informal'::character varying)::text]))),
	CONSTRAINT "expenses_status_check" CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying, 'Rejected'::character varying])::text[])))
);
CREATE TABLE "fraudflags" (
	"flagid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expenseid" uuid NOT NULL,
	"reviewedby" uuid,
	"flaggedby" varchar(50) NOT NULL,
	"flagtype" varchar(50) NOT NULL,
	"reason" text NOT NULL,
	"resolution" varchar(30) DEFAULT 'Pending' NOT NULL,
	"flaggedat" timestamp DEFAULT now() NOT NULL,
	"resolvedat" timestamp,
	CONSTRAINT "fraudflags_check" CHECK (((resolvedat IS NULL) OR (resolvedat >= flaggedat))),
	CONSTRAINT "fraudflags_flaggedby_check" CHECK (((flaggedby)::text = ANY ((ARRAY['system'::character varying, 'manual'::character varying])::text[]))),
	CONSTRAINT "fraudflags_flagtype_check" CHECK (((flagtype)::text = ANY ((ARRAY['BIR_Duplicate'::character varying, 'Vendor_Validation'::character varying, 'Ticket_Mismatch'::character varying])::text[]))),
	CONSTRAINT "fraudflags_resolution_check" CHECK (((resolution)::text = ANY ((ARRAY['Pending'::character varying, 'Approved'::character varying, 'Rejected'::character varying])::text[])))
);
CREATE TABLE "milestones" (
	"milestoneid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"projectid" uuid NOT NULL,
	"createdby" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"duedate" date NOT NULL,
	"completionpercentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"status" varchar(30) DEFAULT 'On Track' NOT NULL,
	"completedat" timestamp,
	CONSTRAINT "milestones_completionpercentage_check" CHECK (((completionpercentage >= (0)::numeric) AND (completionpercentage <= (100)::numeric))),
	CONSTRAINT "milestones_status_check" CHECK (((status)::text = ANY ((ARRAY['On Track'::character varying, 'At Risk'::character varying, 'Overdue'::character varying, 'Completed'::character varying])::text[])))
);
CREATE TABLE "notifications" (
	"notificationid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"recipientid" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"relatedentitytype" varchar(30) NOT NULL,
	"relatedentityid" uuid NOT NULL,
	"message" text NOT NULL,
	"isread" boolean DEFAULT false NOT NULL,
	"createdat" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_relatedentitytype_check" CHECK (((relatedentitytype)::text = ANY ((ARRAY['Milestone'::character varying, 'Task'::character varying])::text[]))),
	CONSTRAINT "notifications_type_check" CHECK (((type)::text = 'ScheduleVarianceAlert'::text))
);
CREATE TABLE "projects" (
	"projectid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"createdby" uuid NOT NULL,
	"name" varchar(150) NOT NULL,
	"description" text,
	"clientname" varchar(150) NOT NULL,
	"status" varchar(30) DEFAULT 'Draft' NOT NULL,
	"startdate" date NOT NULL,
	"enddate" date,
	"budget" numeric(15, 2) NOT NULL,
	"projectmanagerid" uuid NOT NULL,
	"sitemanagerid" uuid,
	CONSTRAINT "projects_budget_check" CHECK ((budget >= (0)::numeric)),
	CONSTRAINT "projects_status_check" CHECK (((status)::text = ANY ((ARRAY['Draft'::character varying, 'Active'::character varying, 'Completed'::character varying, 'Archived'::character varying])::text[])))
);
CREATE TABLE "receiptallocations" (
	"allocationid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expenseid" uuid NOT NULL,
	"projectid" uuid NOT NULL,
	"allocatedamount" numeric(12, 2) NOT NULL,
	"commonreceiptid" varchar(100) NOT NULL,
	"createdat" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "receiptallocations_allocatedamount_check" CHECK ((allocatedamount >= (0)::numeric))
);
CREATE TABLE "sync_test_records" (
	"uuid" uuid PRIMARY KEY,
	"payload" jsonb NOT NULL,
	"synced_at" timestamp DEFAULT now()
);
CREATE TABLE "tamper_alerts" (
	"alertid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"expenseid" uuid NOT NULL,
	"recomputedhash" varchar(100) NOT NULL,
	"onchainhash" varchar(100) NOT NULL,
	"detectedat" timestamp DEFAULT now() NOT NULL,
	"resolvedat" timestamp,
	"notifiedsysadmin" boolean DEFAULT false NOT NULL
);
CREATE TABLE "tasks" (
	"taskid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"milestoneid" uuid NOT NULL,
	"assignedto" uuid NOT NULL,
	"updatedby" uuid,
	"taskname" varchar(150) NOT NULL,
	"completionpercentage" numeric(5, 2) DEFAULT '0' NOT NULL,
	"photoevidenceurl" text,
	"status" varchar(30) DEFAULT 'Pending' NOT NULL,
	"duedate" date NOT NULL,
	"issuereport" text,
	"schedulevariancealertsent" boolean DEFAULT false NOT NULL,
	"lastupdatedat" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_completionpercentage_check" CHECK (((completionpercentage >= (0)::numeric) AND (completionpercentage <= (100)::numeric))),
	CONSTRAINT "tasks_status_check" CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'In Progress'::character varying, 'Completed'::character varying])::text[])))
);
CREATE TABLE "ticket_status_transitions" (
	"transitionid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"ticketid" uuid NOT NULL,
	"fromstatus" varchar(30),
	"tostatus" varchar(30) NOT NULL,
	"changedby" uuid NOT NULL,
	"changedat" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_status_transitions_tostatus_check" CHECK (((tostatus)::text = ANY ((ARRAY['Pending'::character varying, 'Acknowledged'::character varying, 'Resolved'::character varying, 'Rejected'::character varying])::text[])))
);
CREATE TABLE "tickets" (
	"ticketid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"projectid" uuid NOT NULL,
	"submittedby" uuid NOT NULL,
	"resolvedby" uuid,
	"assignedto" uuid,
	"tickettype" varchar(50) NOT NULL,
	"subject" varchar(100) NOT NULL,
	"description" text,
	"status" varchar(30) DEFAULT 'Pending' NOT NULL,
	"photourl" text,
	"createdat" timestamp DEFAULT now() NOT NULL,
	"resolvedat" timestamp,
	"updatedat" timestamp DEFAULT now() NOT NULL,
	"acknowledgedat" timestamp,
	"acknowledgedby" uuid,
	CONSTRAINT "tickets_check" CHECK (((resolvedat IS NULL) OR (resolvedat >= createdat))),
	CONSTRAINT "tickets_check1" CHECK (((acknowledgedat IS NULL) OR (acknowledgedat >= createdat))),
	CONSTRAINT "tickets_status_check" CHECK (((status)::text = ANY ((ARRAY['Pending'::character varying, 'Acknowledged'::character varying, 'Resolved'::character varying, 'Rejected'::character varying])::text[]))),
	CONSTRAINT "tickets_tickettype_check" CHECK (((tickettype)::text = ANY ((ARRAY['Material Request'::character varying, 'Work Item'::character varying])::text[])))
);
CREATE TABLE "users" (
	"userid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" varchar(100) NOT NULL,
	"email" varchar(150) NOT NULL CONSTRAINT "users_email_key" UNIQUE,
	"supabaseuserid" uuid NOT NULL CONSTRAINT "users_supabaseuserid_key" UNIQUE,
	"role" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'Active' NOT NULL,
	"lockoutuntil" timestamp,
	"createdat" timestamp DEFAULT now() NOT NULL,
	"failedloginattempts" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "users_role_check" CHECK (((role)::text = ANY ((ARRAY['General Manager'::character varying, 'Project Manager'::character varying, 'Site Manager'::character varying, 'Purchaser'::character varying, 'System Administrator'::character varying])::text[]))),
	CONSTRAINT "users_status_check" CHECK (((status)::text = ANY ((ARRAY['Active'::character varying, 'Inactive'::character varying])::text[])))
);
CREATE TABLE "vendormasterlist" (
	"vendorid" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"addedby" uuid NOT NULL,
	"vendorname" varchar(200) NOT NULL CONSTRAINT "vendormasterlist_vendorname_key" UNIQUE,
	"location" varchar(200),
	"historicalaverage" numeric(12, 2),
	"approvalstatus" varchar(20) DEFAULT 'Approved' NOT NULL,
	"createdat" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "vendormasterlist_approvalstatus_check" CHECK (((approvalstatus)::text = ANY ((ARRAY['Approved'::character varying, 'Flagged'::character varying])::text[])))
);
CREATE UNIQUE INDEX "blockchainlogs_pkey" ON "blockchainlogs" ("logid");
CREATE UNIQUE INDEX "blockchainlogs_txhash_key" ON "blockchainlogs" ("txhash");
CREATE UNIQUE INDEX "expenses_pkey" ON "expenses" ("expenseid");
CREATE UNIQUE INDEX "fraudflags_pkey" ON "fraudflags" ("flagid");
CREATE UNIQUE INDEX "milestones_pkey" ON "milestones" ("milestoneid");
CREATE UNIQUE INDEX "notifications_pkey" ON "notifications" ("notificationid");
CREATE UNIQUE INDEX "projects_pkey" ON "projects" ("projectid");
CREATE UNIQUE INDEX "receiptallocations_pkey" ON "receiptallocations" ("allocationid");
CREATE UNIQUE INDEX "sync_test_records_pkey" ON "sync_test_records" ("uuid");
CREATE UNIQUE INDEX "tamper_alerts_pkey" ON "tamper_alerts" ("alertid");
CREATE UNIQUE INDEX "tasks_pkey" ON "tasks" ("taskid");
CREATE UNIQUE INDEX "ticket_status_transitions_pkey" ON "ticket_status_transitions" ("transitionid");
CREATE UNIQUE INDEX "tickets_pkey" ON "tickets" ("ticketid");
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");
CREATE UNIQUE INDEX "users_pkey" ON "users" ("userid");
CREATE UNIQUE INDEX "users_supabaseuserid_key" ON "users" ("supabaseuserid");
CREATE UNIQUE INDEX "vendormasterlist_pkey" ON "vendormasterlist" ("vendorid");
CREATE UNIQUE INDEX "vendormasterlist_vendorname_key" ON "vendormasterlist" ("vendorname");
ALTER TABLE "blockchainlogs" ADD CONSTRAINT "blockchainlogs_actorid_fkey" FOREIGN KEY ("actorid") REFERENCES "users"("userid");
ALTER TABLE "blockchainlogs" ADD CONSTRAINT "blockchainlogs_expenseid_fkey" FOREIGN KEY ("expenseid") REFERENCES "expenses"("expenseid");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approvedby_fkey" FOREIGN KEY ("approvedby") REFERENCES "users"("userid");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_projectid_fkey" FOREIGN KEY ("projectid") REFERENCES "projects"("projectid");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_submittedby_fkey" FOREIGN KEY ("submittedby") REFERENCES "users"("userid");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_ticketid_fkey" FOREIGN KEY ("ticketid") REFERENCES "tickets"("ticketid");
ALTER TABLE "fraudflags" ADD CONSTRAINT "fraudflags_expenseid_fkey" FOREIGN KEY ("expenseid") REFERENCES "expenses"("expenseid");
ALTER TABLE "fraudflags" ADD CONSTRAINT "fraudflags_reviewedby_fkey" FOREIGN KEY ("reviewedby") REFERENCES "users"("userid");
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_createdby_fkey" FOREIGN KEY ("createdby") REFERENCES "users"("userid");
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_projectid_fkey" FOREIGN KEY ("projectid") REFERENCES "projects"("projectid");
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientid_fkey" FOREIGN KEY ("recipientid") REFERENCES "users"("userid");
ALTER TABLE "projects" ADD CONSTRAINT "projects_createdby_fkey" FOREIGN KEY ("createdby") REFERENCES "users"("userid");
ALTER TABLE "projects" ADD CONSTRAINT "projects_projectmanagerid_fkey" FOREIGN KEY ("projectmanagerid") REFERENCES "users"("userid");
ALTER TABLE "projects" ADD CONSTRAINT "projects_sitemanagerid_fkey" FOREIGN KEY ("sitemanagerid") REFERENCES "users"("userid");
ALTER TABLE "receiptallocations" ADD CONSTRAINT "receiptallocations_expenseid_fkey" FOREIGN KEY ("expenseid") REFERENCES "expenses"("expenseid");
ALTER TABLE "receiptallocations" ADD CONSTRAINT "receiptallocations_projectid_fkey" FOREIGN KEY ("projectid") REFERENCES "projects"("projectid");
ALTER TABLE "tamper_alerts" ADD CONSTRAINT "tamper_alerts_expenseid_fkey" FOREIGN KEY ("expenseid") REFERENCES "expenses"("expenseid");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedto_fkey" FOREIGN KEY ("assignedto") REFERENCES "users"("userid");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestoneid_fkey" FOREIGN KEY ("milestoneid") REFERENCES "milestones"("milestoneid");
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_updatedby_fkey" FOREIGN KEY ("updatedby") REFERENCES "users"("userid");
ALTER TABLE "ticket_status_transitions" ADD CONSTRAINT "ticket_status_transitions_changedby_fkey" FOREIGN KEY ("changedby") REFERENCES "users"("userid");
ALTER TABLE "ticket_status_transitions" ADD CONSTRAINT "ticket_status_transitions_ticketid_fkey" FOREIGN KEY ("ticketid") REFERENCES "tickets"("ticketid");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_acknowledgedby_fkey" FOREIGN KEY ("acknowledgedby") REFERENCES "users"("userid");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assignedto_fkey" FOREIGN KEY ("assignedto") REFERENCES "users"("userid");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_projectid_fkey" FOREIGN KEY ("projectid") REFERENCES "projects"("projectid");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_resolvedby_fkey" FOREIGN KEY ("resolvedby") REFERENCES "users"("userid");
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_submittedby_fkey" FOREIGN KEY ("submittedby") REFERENCES "users"("userid");
ALTER TABLE "vendormasterlist" ADD CONSTRAINT "vendormasterlist_addedby_fkey" FOREIGN KEY ("addedby") REFERENCES "users"("userid");