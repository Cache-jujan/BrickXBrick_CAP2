-- infra/db/migrations/007_notifications.sql
CREATE TABLE notifications (
    notificationId    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipientId       UUID NOT NULL REFERENCES users(userId),
    type              VARCHAR(50) NOT NULL CHECK (type IN ('ScheduleVarianceAlert')), -- extend this list as more notification types get built
    relatedEntityType VARCHAR(30) NOT NULL CHECK (relatedEntityType IN ('Milestone', 'Task')),
    relatedEntityId   UUID NOT NULL,
    message           TEXT NOT NULL,
    isRead            BOOLEAN NOT NULL DEFAULT FALSE,
    createdAt         TIMESTAMP NOT NULL DEFAULT NOW()
);