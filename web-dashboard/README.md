# PRGTracker web dashboard

This folder is the deployable, read-only companion for PRGLauncher. Publish its
contents as the site directory in Netlify (or replace the current Netlify
project source with this folder). It reads the read-only document
`public-dashboard/<uid>` in Firestore when the URL contains `?u=<uid>`; the
desktop launcher creates and refreshes that document automatically.

The dashboard never displays notes, Steam app IDs, download controls, or edit
controls. It displays the public yearly recap and games played in the selected
year; the editable library remains private to the desktop app.
