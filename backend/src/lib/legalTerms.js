// Terms of Use and Privacy Notice for Brick x Brick.
//
// This file is the ONE place the text lives. The web app and the mobile app
// both load it from GET /api/legal, so they always show the same words.
//
// Philippine laws this is written against:
//   - Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing
//     Rules, plus National Privacy Commission (NPC) circulars
//   - Cybercrime Prevention Act of 2012 (Republic Act No. 10175)
//   - Electronic Commerce Act of 2000 (Republic Act No. 8792), which makes
//     clicking "I agree" a valid electronic acceptance
//
// THIS IS A DRAFT. It must be reviewed by the adviser and the company before
// real use. 
//
// Changing the text? Raise TERMS_VERSION. Everyone is then asked to accept
// the new version on their next sign-in, and the old acceptances stay on record.

const TERMS_VERSION = "1.0";
const EFFECTIVE_DATE = "2026-10-15";

const COMPANY = "JJC-R Building Design and Drafting Services";
const COMPANY_ADDRESS = "2F, Alivio Building, Central Nautical Hwy, Cansaga, Consolacion, 6001 Cebu";
const DPO_CONTACT = "[Data Protection Officer name and email]";

const termsOfUse = {
  id: "terms",
  title: "Terms of Use",
  sections: [
    {
      heading: "1. About these terms",
      paragraphs: [
        `Brick x Brick is the construction project and expense management system used by ${COMPANY} ("the Company"). These Terms of Use apply to everyone who signs in to the web or mobile app.`,
        "By selecting \"I agree\", you accept these terms electronically. Under the Electronic Commerce Act (Republic Act No. 8792), this has the same effect as signing them on paper.",
      ],
    },
    {
      heading: "2. Who may use the system",
      paragraphs: [
        "Only people given an account by the Company's System Administrator may use Brick x Brick, and only for their work for the Company. Your role (General Manager, Project Manager, Site Manager, Purchaser or System Administrator) decides what you can see and do.",
      ],
    },
    {
      heading: "3. Your account",
      bullets: [
        "Keep your password secret. Do not share your account or let someone else use it.",
        "Everything done under your account is recorded as done by you.",
        "Tell the System Administrator right away if you think someone else has used your account.",
        "After five wrong password attempts, the account is locked for 15 minutes.",
        "The Company may deactivate your account, for example when you leave the Company or break these terms.",
      ],
    },
    {
      heading: "4. Honest and accurate records",
      paragraphs: [
        "Expenses, receipts, material requests and progress updates must be true and complete. Submitting a fake, altered or duplicate receipt, or a false progress update, is a serious violation. It may lead to disciplinary action and may be reported to the authorities.",
      ],
    },
    {
      heading: "5. Confidential information",
      paragraphs: [
        "Project information in the system belongs to the Company and its clients. This includes Bills of Materials, prices, budgets, client names, receipts and site photos. Use it only for your work. Do not copy, screenshot, forward or post it outside the Company without permission.",
      ],
    },
    {
      heading: "6. Monitoring and record protection",
      bullets: [
        "The system keeps a record of important actions: who created, approved, rejected or changed a record, and when.",
        "When an expense is approved, a digital fingerprint (hash) of it is stored on the Company's private blockchain. Any later change to that expense is detected and reported to the General Managers and System Administrators.",
        "Tamper alerts cannot be deleted. Reviewing an alert records who reviewed it, when and why.",
      ],
    },
    {
      heading: "7. What you must not do",
      bullets: [
        "Access an account, record or part of the system you were not given access to.",
        "Change or delete records outside the normal screens of the app (for example directly in the database).",
        "Try to get around security, approvals or the record-protection features.",
        "Upload harmful files, or anything unrelated to your work.",
      ],
      paragraphs: [
        "Unauthorized access, data interference and system interference are crimes under the Cybercrime Prevention Act of 2012 (Republic Act No. 10175).",
      ],
    },
    {
      heading: "8. Availability",
      paragraphs: [
        "The Company aims to keep the system available but cannot promise it will always be online or error-free. The mobile app can save some work offline and send it once you are connected again. Keep the original paper receipts as the Company instructs.",
      ],
    },
    {
      heading: "9. Changes to these terms",
      paragraphs: [
        "The Company may update these terms. When it does, you will be asked to read and accept the new version the next time you sign in.",
      ],
    },
    {
      heading: "10. Governing law",
      paragraphs: [
        "These terms are governed by the laws of the Republic of the Philippines.",
      ],
    },
  ],
};

const privacyNotice = {
  id: "privacy",
  title: "Privacy Notice",
  sections: [
    {
      heading: "1. Who is responsible for your data",
      paragraphs: [
        `${COMPANY}, ${COMPANY_ADDRESS}, is the personal information controller for Brick x Brick under the Data Privacy Act of 2012 (Republic Act No. 10173). For questions or requests about your personal data, contact the Data Protection Officer: ${DPO_CONTACT}.`,
      ],
    },
    {
      heading: "2. What personal data we collect",
      bullets: [
        "Account details: your name, work email address and role.",
        "Sign-in details: login attempts and lockouts, and the date, time, IP address and device/browser type when you accept these terms.",
        "Work records you create: material requests, tickets, task progress updates, expenses and approvals, each with your name and the time.",
        "Files you upload: receipt images or PDFs and site progress photos. These may show other people or places by accident; avoid this where you can.",
        "Receipt details read from uploads: vendor name, TIN, permit numbers, dates, items and amounts. For sole proprietors, a TIN can be personal data.",
      ],
    },
    {
      heading: "3. Why we use it",
      bullets: [
        "To run the Company's projects: planning, purchasing, progress tracking and approvals.",
        "To check receipts and expenses and to prevent fraud (duplicate receipts, unknown vendors, records changed after approval).",
        "To keep books and records as required by the Bureau of Internal Revenue and other laws.",
        "To keep accounts secure and to investigate problems or misuse.",
      ],
      paragraphs: [
        "The legal bases are your work relationship with the Company, the Company's legal obligations, and its legitimate interest in preventing fraud and protecting its records (Sections 12 and 13 of the Data Privacy Act).",
      ],
    },
    {
      heading: "4. The blockchain",
      paragraphs: [
        "When an expense is approved, only a fingerprint (a SHA-256 hash) of it is written to the Company's private blockchain. The fingerprint cannot be turned back into your name or the expense details. Blockchain entries cannot be deleted, so the fingerprint stays even if the expense record itself is later deleted under Section 7.",
      ],
    },
    {
      heading: "5. Who processes the data for us",
      paragraphs: [
        "We use these service providers to run the system. They process data only on the Company's instructions:",
      ],
      bullets: [
        "Supabase: sign-in and account security.",
        "Neon: the database.",
        "Cloudflare R2: storage of receipt files and photos.",
        "Google Cloud (Vision and Gemini): reading text from receipt images.",
        "Vercel and the backend hosting provider: running the web app and server.",
        "Amazon Web Services or Hetzner: running the blockchain servers.",
      ],
    },
    {
      heading: "6. Data stored outside the Philippines",
      paragraphs: [
        "Some of these providers store or process data in other countries. The Company remains responsible for your data and requires these providers to protect it, as the Data Privacy Act requires.",
      ],
    },
    {
      heading: "7. How long we keep it",
      paragraphs: [
        "Records are kept while you work with the Company and for as long as tax and accounting laws require for the Company's books and receipts. After that they are deleted or made anonymous. Work saved offline in the mobile app is stored on your phone until it is sent to the server, so keep your phone locked with a PIN or password.",
      ],
    },
    {
      heading: "8. How we protect it",
      bullets: [
        "Encrypted connections (HTTPS) and password-protected accounts with lockout after repeated failures.",
        "Each role sees only what its work needs. For example, unit costs are hidden from Site Managers and Purchasers.",
        "Approved expenses are protected against later changes by the blockchain fingerprint and tamper alerts.",
      ],
      paragraphs: [
        "If a personal data breach happens, the Company will notify the National Privacy Commission and the people affected, as the law requires.",
      ],
    },
    {
      heading: "9. Your rights",
      paragraphs: [
        "Under the Data Privacy Act you have the right to:",
      ],
      bullets: [
        "be informed about how your data is used (this notice);",
        "access your personal data;",
        "have wrong or incomplete data corrected;",
        "object to processing, or ask for blocking or deletion, where the law allows (records the Company must keep by law may be kept);",
        "get a copy of your data in a usable format (data portability);",
        "claim damages for harm caused by inaccurate, incomplete or unlawfully used data;",
        "file a complaint with the National Privacy Commission (privacy.gov.ph).",
      ],
    },
    {
      heading: "10. Changes to this notice",
      paragraphs: [
        "If this notice changes, you will be asked to read and accept the new version the next time you sign in.",
      ],
    },
  ],
};

// Plain-language summary shown above the full text ("At a glance"). It only
// restates what the two documents say; the full text is what is agreed to.
// `icon` is a name the web and mobile apps map to their own icon.
const highlights = [
  {
    id: "account",
    icon: "account",
    title: "Your account is yours alone",
    text: "Don't share your password. Everything done under your account is recorded as done by you.",
  },
  {
    id: "records",
    icon: "records",
    title: "Keep every record honest",
    text: "Receipts and updates must be true. Approved expenses are fingerprinted on the blockchain, so later changes are detected.",
  },
  {
    id: "data",
    icon: "data",
    title: "What we collect and why",
    text: "Your account details, your work records and uploads, used to run projects, check expenses and keep the books the BIR requires.",
  },
  {
    id: "rights",
    icon: "rights",
    title: "You stay in control",
    text: "You can access and correct your data, and complain to the National Privacy Commission (RA 10173).",
  },
];

function legalDocuments() {
  return {
    version: TERMS_VERSION,
    effectiveDate: EFFECTIVE_DATE,
    highlights,
    documents: [termsOfUse, privacyNotice],
  };
}

module.exports = { TERMS_VERSION, EFFECTIVE_DATE, legalDocuments };
