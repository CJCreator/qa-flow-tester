# Privacy

This policy covers the QA Flow Tester (Release check-up) software and the shared online copy of it. Plain words, based on how the code works. It is not legal advice.

## Two ways to use it

**1. Your own copy (self-hosted).** You run the tool on your own computer or server. Everything it stores stays there: site memory and history in the data folder (`RUNNER_DATA_DIR`, default `.qa-data/`), reports in the report folder (`RUNNER_OUTPUT_DIR`), and your AI key settings in the local settings files. Nothing is sent to the project's authors. If you use AI, the page text the plan needs is sent to the AI Provider you choose (see Free AI models). Planning without AI keeps everything on your machine.

**2. The shared online copy.** Anyone with the link can run checks on public sites, within a daily limit. Here is what that copy does:

- **Session cookie.** It sets one cookie to tell your visits apart. The cookie is needed for the copy to work.
- **AI keys.** If you enter your own AI key, it is kept in the server's memory for your session only. It is not written to the disk of the shared copy and is lost when the session ends or the server restarts.
- **Sign-in details for the sites you test.** If you give a test account's username and password, they are used to sign in to that site for the check. They are not saved to the report, the plan, or the logs. The saved sign-in session is kept in a private folder and is never shown in the report.
- **Reports and evidence.** A check writes its report and screenshots to the server so you can view and download them. On the shared copy, a report can be opened only from the session that started it. The server itself stores those files, and whoever runs the server can reach them. Do not check a site whose pages hold private or customer data.
- **The sites you check.** The tool requests pages from the site you give it, as a browser would, and records what it finds. Only check sites you own or have permission to test.

## Signing in with Google (owners and Helpers)

Google sign-in runs through Firebase Authentication in a pop-up. The page hands the sign-in token to the runner once and keeps nothing in the browser's storage. The runner sets one cookie holding the Google account's email and account id, signed, for at most 8 hours. A Helper's access to a Website Audit is stored with that audit.

## Website Audits on the shared online copy

Saved audits keep Page Content, screenshots, Audit Documents and edits, the Shortlist entry and its notes, Shared Links, and Helper grants. These are kept in one Google Cloud Storage bucket in `us-central1` that only the runner can reach. They stay until the owner deletes the Website Audit. Deleting removes all of it and cannot be undone. A Shared Link expires 30 days after it is made and can be revoked.

## Scheduled Check-ups

The schedule list (each address, its hour and options) is stored in the same bucket until the schedule is deleted. Scheduled Check-ups run without AI and only look (read-only).

## Free AI models

Free models are run by third-party providers. Those providers may keep what is sent to them and may use it to learn. The wizard says this next to the free-model choice. Do not send private or customer data through a free model.

## What we do not do

- We do not sell data or show ads.
- We do not add analytics or tracking to the wizard.
- We do not read your AI keys or your sign-in details, except to use them for the check you asked for.

## Your choices

- Use your own copy if you need full control of your data.
- Use your own AI key rather than a free model if the site's content is sensitive.
- Delete reports and folders on your own copy at any time.

## Questions

Open an issue at https://github.com/CJCreator/qa-flow-tester/issues. Do not put keys, passwords or private data in an issue.

## Changes

This policy changes when the software changes how it handles data. The version in the repository is the current one.
